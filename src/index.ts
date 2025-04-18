import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import csv from 'csv-parser';
import ExcelJS from 'exceljs';
import type { Page } from 'puppeteer';


// Use stealth plugin to avoid bot detection
puppeteer.use(StealthPlugin());

// Helper function for random delays
const randomDelay = () => new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

// Main page analysis function
async function analyzePage(page: Page, url: string) {
    try {
        console.log(`🔍 Visiting: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        // Try closing login popup (if any)
        try {
            const closeButtonSelector = 'div[role="dialog"] div[aria-label="Close"]';
            await page.waitForSelector(closeButtonSelector, { timeout: 5000 });
            await page.click(closeButtonSelector);
        } catch (e) {
            // Dialog didn't appear — that's okay
        }

        await randomDelay();

        // Extract Page Name
        const pageName = await page.$eval('h1', el => el.textContent?.trim() || 'N/A');

        // Extract Follower Count
        const followers = await page.$$eval('div[role="main"] span', spans => {
            const match = spans.find(span => span.textContent?.includes('followers'));
            return match?.textContent?.split(' ')[0] || 'N/A';
        });

        // Extract Page Category
        const category = await page.$$eval('div[role="main"] span', spans => {
            const match = spans.find(span => span.textContent?.includes('website') || span.textContent?.includes('Company') || span.textContent?.includes('Education'));
            return match?.textContent?.trim() || 'N/A';
        });

        // Extract Last Posted Text
        await page.waitForSelector('div[data-pagelet^="FeedUnit"] span[dir="ltr"]', { timeout: 10000 });
        const spanTexts = await page.$$eval('div[data-pagelet^="FeedUnit"] span[dir="ltr"]', els =>
            els.map(el => el.textContent?.trim())
        );
        const lastPosted = (spanTexts[1] || '').split('·')[0].trim();

        // Determine if the post is from 2025
        let pageStatus = 'Not Active';
        try {
            const now = new Date();

            // Match things like "2d", "1w", "3h"
            if (/\d+[dwmyh]/i.test(lastPosted)) {
                const amount = parseInt(lastPosted);
                if (lastPosted.includes('d')) {
                    const daysAgo = new Date();
                    daysAgo.setDate(now.getDate() - amount);
                    if (daysAgo.getFullYear() === 2025) pageStatus = 'Active';
                } else if (lastPosted.includes('w')) {
                    const weeksAgo = new Date();
                    weeksAgo.setDate(now.getDate() - amount * 7);
                    if (weeksAgo.getFullYear() === 2025) pageStatus = 'Active';
                } else if (lastPosted.includes('h')) {
                    if (now.getFullYear() === 2025) pageStatus = 'Active';
                }
            } else {
                // For date-like text such as "April 10"
                const postDate = new Date(`${lastPosted}, 2025`);
                if (postDate instanceof Date && !isNaN(postDate.getTime()) && postDate.getFullYear() === 2025) {
                    pageStatus = 'Active';
                }
            }
        } catch (e) {
            console.warn(`⚠️ Failed to interpret lastPosted: ${lastPosted}`, e);
            pageStatus = 'Error';
        }

        return {
            LINK: url,
            PAGE_NAME: pageName,
            FOLLOWERS: followers,
            PAGEDETAILS: category,
            LAST_POSTED: lastPosted,
            PAGE_STATUS: pageStatus
        };
    } catch (err) {
        console.error(`❌ Failed to analyze ${url}:`, err);
        return {
            LINK: url,
            PAGE_NAME: 'Error',
            FOLLOWERS: 'Error',
            PAGEDETAILS: 'Error',
            LAST_POSTED: 'Error',
            PAGE_STATUS: 'Error'
        };
    }
}

async function main() {
    const links: string[] = [];

    // Step 1: Read URLs from CSV
    await new Promise<void>((resolve, reject) => {
        fs.createReadStream('link.csv')
            .pipe(csv())
            .on('data', (row) => {
                if (row.URL) links.push(row.URL);
            })
            .on('end', resolve)
            .on('error', reject);
    });

    // Step 2: Setup Puppeteer
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: null
    });

    const page = await browser.newPage();

    // Use a realistic browser profile
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
    await page.setJavaScriptEnabled(true);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
    });

    // Step 3: Loop and scrape each page
    const results = [];
    for (const link of links) {
        const data = await analyzePage(page, link);
        results.push(data);
    }

    await browser.close();

    // Step 4: Export to Excel
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Facebook Pages');

    sheet.columns = [
        { header: 'LINK', key: 'LINK', width: 35 },
        { header: 'PAGE NAME', key: 'PAGE_NAME', width: 30 },
        { header: 'FOLLOWERS', key: 'FOLLOWERS', width: 15 },
        { header: 'PAGEDETAILS', key: 'PAGEDETAILS', width: 25 },
        { header: 'LAST POSTED', key: 'LAST_POSTED', width: 25 },
        { header: 'PAGE STATUS', key: 'PAGE_STATUS', width: 15 }
    ];

    results.forEach(row => {
        const excelRow = sheet.addRow(row);

        if (row.PAGE_STATUS === 'Not Active') {
            // Highlight Not Active rows in red
            excelRow.getCell('PAGE_STATUS').fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFF0000' }
            };
        } else if (row.PAGE_STATUS === 'Active') {
            // Highlight Active rows in green
            excelRow.getCell('PAGE_STATUS').fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF00FF00' }
            };
        }
    });

    await workbook.xlsx.writeFile('FacebookPages.xlsx');
    console.log('✅ Excel file created: FacebookPages.xlsx');
}

main();
