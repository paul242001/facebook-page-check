import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import csv from 'csv-parser';
import ExcelJS from 'exceljs';
import type { Page, Browser } from 'puppeteer';

puppeteer.use(StealthPlugin());

const randomDelay = () => new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

async function analyzePage(page: Page, url: string) {
    console.log(`🔍 Analyzing: ${url}`);
    try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        // Try to close login dialog if it appears
        try {
            const closeButtonSelector = 'div[role="dialog"] div[aria-label="Close"]';
            await page.waitForSelector(closeButtonSelector, { timeout: 5000 });
            await page.click(closeButtonSelector);
        } catch (e) {
            // Dialog didn't appear, ignore
        }

        await randomDelay();

        // ========== Extract Page Name ==========
        let pageName = 'N/A';
        try {
            pageName = await page.$eval('h1.html-h1', el => el.textContent?.trim() || 'N/A');
        } catch (err) {
            console.warn(`⚠️ Page name not found for: ${url}`);
        }

        // ========== Extract Follower Count ==========
        let followers = 'N/A';
        try {
            const followersText = await page.$eval('a[href*="/followers"]', el =>
                el.textContent?.trim() || ''
            );
            followers = followersText.split(' ')[0].trim();
        } catch (err) {
            console.warn(`⚠️ Followers not found for: ${url}`);
        }

        // ========== Extract Page Category ==========
        let category = 'N/A';
        try {
            const pageDetailsSelector = 'strong.html-strong';
            category = await page.$eval(pageDetailsSelector, el => {
                const nextText = el.nextSibling?.textContent?.trim() || '';
                return nextText.replace(/^·\s*/, '');
            });
        } catch (err) {
            console.warn(`⚠️ Category not found for: ${url}`);
        }

        // ========== Extract Last Posted Date ==========
        let lastPosted = 'N/A';
        try {
            await page.waitForSelector('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', { timeout: 10000 });
            const spanTexts = await page.$$eval('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', els =>
                els.map(el => el.textContent?.trim())
            );
            lastPosted = (spanTexts[1] || '').split('·')[0].trim();
        } catch (err) {
            console.warn(`⚠️ Last posted date not found for: ${url}`);
        }

        // ========== Determine Page Status ==========
        const isActive = isPostRecent(lastPosted);
        const pageStatus = isActive ? 'Active' : 'Not Active';

        console.log(`✅ Done analyzing: ${url}`);
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
function isPostRecent(lastPosted: string): boolean {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    // Case 1: Relative time (e.g., 2d, 3h, 15m)
    const relativeMatch = lastPosted.trim().match(/^(\d+)([mhdsw])$/i);
    if (relativeMatch) {
        const value = parseInt(relativeMatch[1]);
        const unit = relativeMatch[2].toLowerCase();

        const msMap: Record<string, number> = {
            s: 1000,
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
            w: 7 * 24 * 60 * 60 * 1000
        };

        const msAgo = value * msMap[unit];
        const postTime = new Date(now.getTime() - msAgo);
        return postTime >= cutoff;
    }

    // Case 2: Full date with year (e.g., "February 22, 2024" or "2024-02-22")
    const parsedDate = new Date(lastPosted);
    if (!isNaN(parsedDate.getTime()) && /\d{4}/.test(lastPosted)) {
        return parsedDate >= cutoff;
    }

    // Case 3: Month and day only (e.g., "February 22")
    const noYearMatch = lastPosted.match(/^[A-Za-z]+\s+\d{1,2}$/);
    if (noYearMatch) {
        // ✅ As per your instruction: If no year is included, we assume it's active
        return true;
    }

    // Unknown or unrecognized format – assume inactive
    return false;
}

/**
 * Save failed URLs to a CSV file
 * @param failedLinks - array of failed links
 */
function saveFailedLinks(failedLinks: string[]) {
    const header = 'URL\n';
    const csvContent = failedLinks.map(url => `${url}\n`).join('');
    fs.writeFileSync('failed_links.csv', header + csvContent, 'utf8');
    console.log(`📄 Saved ${failedLinks.length} failed links to failed_links.csv`);
}


/**
 * Converts follower string like "1.2K", "3M", etc. to a real number string
 */
function convertFollowers(value: string): string {
    if (!value) return '0';

    const match = value.trim().match(/^([\d.]+)([KM]?)$/i);
    if (!match) return value;

    const number = parseFloat(match[1]);
    const suffix = match[2].toUpperCase();

    switch (suffix) {
        case 'K':
            return Math.round(number * 1000).toString();
        case 'M':
            return Math.round(number * 1_000_000).toString();
        default:
            return Math.round(number).toString();
    }
}


async function main() {
    const links: string[] = [];

    // Step 1: Read from CSV
    console.log('📥 Reading CSV file...');
    await new Promise<void>((resolve, reject) => {
        fs.createReadStream('link.csv')
            .pipe(csv())
            .on('data', (row) => {
                if (row.URL) links.push(row.URL);
            })
            .on('end', () => {
                console.log(`📄 Total URLs loaded: ${links.length}`);
                resolve();
            })
            .on('error', (err) => {
                console.error('❌ Failed to read CSV:', err);
                reject(err);
            });
    });

    // Step 2: Setup Puppeteer
    console.log('🚀 Launching browser...');
    const browser = await puppeteer.launch({
        headless: true,
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

    console.log('🔄 Starting analysis on all pages...');
    // Step 3: Loop and collect data
    const results = [];
    const failedLinks: string[] = []; // Track failed links
    for (const [index, link] of links.entries()) {
        console.log(`\n📌 (${index + 1}/${links.length}) Processing: ${link}`);
        const data = await analyzePage(page, link);
    
        // ✅ Convert followers string to numeric format
        if (data.FOLLOWERS && data.FOLLOWERS !== 'N/A' && data.FOLLOWERS !== 'Error') {
            data.FOLLOWERS = convertFollowers(data.FOLLOWERS);
        }
    
        results.push(data);
    
        // Track failed pages
        if (data.PAGE_NAME === 'Error') {
            failedLinks.push(link);
        }
    }
    
    

    await browser.close();
    console.log('🛑 Browser closed.');

    // Step 4: Export to Excel
    console.log('📊 Exporting data to Excel...');
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

    saveFailedLinks(failedLinks);

}


main();