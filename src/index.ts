import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import csv from 'csv-parser';
import ExcelJS from 'exceljs';
import type { Page, Browser } from 'puppeteer';

puppeteer.use(StealthPlugin());

const randomDelay = () => new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

async function analyzePage(page: Page, url: string) {
    try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        // Try to close login dialog if it appears
        try {
            const closeButtonSelector = 'div[role="dialog"] div[aria-label="Close"]';
            await page.waitForSelector(closeButtonSelector, { timeout: 5000 });
            await page.click(closeButtonSelector);
        } catch (e) {
            // Dialog didn't show
        }

        await randomDelay();

        // Extract Page Name
        const pageName = await page.$eval('h1.html-h1', el => el.textContent?.trim() || 'N/A');

        // Extract Follower Count
        const followersLinkSelector = `a[href="${url}/followers/"]`;
        const followersText = await page.$eval(followersLinkSelector, el => el.textContent?.trim() || '');
        const followers = followersText.split(' ')[0].trim();

        // Extract Page Category
        const pageDetailsSelector = 'strong.html-strong';
        const category = await page.$eval(pageDetailsSelector, el => {
            const nextText = el.nextSibling?.textContent?.trim() || '';
            return nextText.replace(/^·\s*/, '');
        });

        // Extract Last Posted Date
        await page.waitForSelector('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', { timeout: 10000 });
        const spanTexts = await page.$$eval('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', els =>
            els.map(el => el.textContent?.trim())
        );
        const lastPosted = (spanTexts[1] || '').split('·')[0].trim();

        // Determine Page Status
        const isActive = isPostRecent(lastPosted);
        const pageStatus = isActive ? 'Active' : 'Not Active';

        return { LINK: url, PAGE_NAME: pageName, FOLLOWERS: followers, PAGEDETAILS: category, LAST_POSTED: lastPosted, PAGE_STATUS: pageStatus };
    } catch (err) {
        console.error(`Failed to analyze ${url}:`, err);
        return { LINK: url, PAGE_NAME: 'Error', FOLLOWERS: 'Error', PAGEDETAILS: 'Error', LAST_POSTED: 'Error', PAGE_STATUS: 'Error' };
    }
}
// ✅ Utility function to check if a post is recent
function isPostRecent(lastPosted: string): boolean {
    const now = new Date();

    // Case 1: Relative times
    const relativeMatch = lastPosted.match(/^(\d+)([mhdsw])$/); // e.g., 2d, 5h, 15m
    if (relativeMatch) {
        const value = parseInt(relativeMatch[1]);
        const unit = relativeMatch[2];

        const msMap: Record<string, number> = {
            m: 60 * 1000,        // minute
            h: 60 * 60 * 1000,   // hour
            d: 24 * 60 * 60 * 1000, // day
            s: 1000,             // second
            w: 7 * 24 * 60 * 60 * 1000 // week
        };

        const msAgo = value * msMap[unit];
        const postTime = new Date(now.getTime() - msAgo);

        // Define cutoff: last 30 days = Active
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return postTime >= cutoff;
    }

    // Case 2: Absolute date (e.g., "October 22, 2023")
    const parsedDate = new Date(lastPosted);
    if (!isNaN(parsedDate.getTime())) {
        const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days
        return parsedDate >= cutoff;
    }

    // If date is unknown or can't be parsed
    return false;
}

async function main() {
    const links: string[] = [];

    // Step 1: Read from CSV
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
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: null
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...');
    await page.setJavaScriptEnabled(true);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    // Step 3: Loop and collect data
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
            excelRow.getCell('PAGE_STATUS').fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFF0000' } // red
            };
        }
    });

    await workbook.xlsx.writeFile('FacebookPages.xlsx');
    console.log('✅ Excel file created: FacebookPages.xlsx');
}

main();