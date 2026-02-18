import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import ExcelJS from 'exceljs';
import type { Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

export interface ScraperProgress {
    current: number;
    total: number;
    currentUrl: string;
    status: 'analyzing' | 'completed' | 'error';
    message?: string;
}

export interface ScraperResult {
    outputFile: string;
    failedCount: number;
    totalProcessed: number;
}

interface PageData {
    LINK: string;
    USERNAME?: string;
    PAGE_NAME: string;
    FOLLOWERS: string;
    PAGEDETAILS: string;
    LAST_POSTED: string;
    LOCATION?: string;
    EMAIL_URL?: string;
    INSTAGRAM_URL?: string;
    TIKTOK_URL?: string;
    YOUTUBE_URL?: string;
    X_URL?: string;
    PAGE_STATUS: string;
}

const randomDelay = () => new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

async function randomScroll(page: Page) {
    const scrollTimes = 5;
    const minScrollDelay = 1000;
    const maxScrollDelay = 2000;

    for (let i = 0; i < scrollTimes; i++) {
        const direction = Math.random() > 0.5 ? 1 : -1;
        const distance = Math.floor(Math.random() * 300) + 100;

        await page.evaluate((direction, distance) => {
            window.scrollBy({
                top: direction * distance,
                behavior: 'smooth'
            });
        }, direction, distance);

        const delay = Math.floor(Math.random() * (maxScrollDelay - minScrollDelay) + minScrollDelay);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
}

function isPostRecent(lastPosted: string): boolean {
    const trimmed = lastPosted.trim().toLowerCase();

    if (!trimmed || trimmed === 'n/a') {
        return false;
    }

    if (/\d{4}/.test(trimmed)) {
        return false;
    }

    if (!/\d/.test(trimmed)) {
        return false;
    }

    return true;
}

function cleanSocialLink(link: string, platform: string, baseUrl: string): string {
    if (link.startsWith('/')) {
        link = new URL(link, baseUrl).href;
    }

    if (link.includes('@l.php')) {
        console.warn(`Obfuscated link found for ${platform}: ${link}`);
        return '';
    }

    return link;
}

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

async function analyzePage(page: Page, url: string): Promise<PageData> {
    console.log(`Analyzing: ${url}`);
    try {
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 100000 });

        try {
            const closeButtonSelector = 'div[role="dialog"] div[aria-label="Close"]';
            await page.waitForSelector(closeButtonSelector, { timeout: 5000 });
            await page.click(closeButtonSelector);
        } catch (e) {
            // Dialog didn't appear, ignore
        }

        await randomDelay();
        await randomScroll(page);

        // Extract Page Name
        let pageName = 'N/A';
        try {
            pageName = await page.$eval('h1.html-h1', el => el.textContent?.trim() || 'N/A');
        } catch (err) {
            console.warn(`Page name not found for: ${url}`);
        }

        // Extract Follower Count
        let followers = 'N/A';
        try {
            const followerText = await page.$$eval('a[href*="followers"]', links => {
                for (const link of links) {
                    const text = link.textContent?.trim() || '';
                    if (text.toLowerCase().includes('followers')) {
                        return text;
                    }
                }
                return '';
            });

            const match = followerText.match(/[\d.,KMB]+/i);
            if (match) {
                followers = match[0];
            }
        } catch (err) {
            console.warn(`Followers not found for: ${url}`);
        }

        // Extract Page Category
        let category = 'N/A';
        try {
            const pageDetailsSelector = 'strong.html-strong';
            category = await page.$eval(pageDetailsSelector, el => {
                const nextText = el.nextSibling?.textContent?.trim() || '';
                return nextText.replace(/^·\s*/, '');
            });
        } catch (err) {
            console.warn(`Category not found for: ${url}`);
        }

        // Extract Last Posted Date
        let lastPosted = 'N/A';
        try {
            await page.waitForSelector('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', { timeout: 10000 });
            const spanTexts = await page.$$eval('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', els =>
                els.map(el => el.textContent?.trim())
            );
            lastPosted = (spanTexts[1] || '').split('·')[0].trim();
        } catch (err) {
            console.warn(`Last posted date not found for: ${url}`);
        }

        // Extract Location
        let location = '';
        try {
            await page.waitForSelector('span[dir="auto"]', { timeout: 5000 });
            const spanTexts = await page.$$eval('span[dir="auto"]', spans =>
                spans.map(span => span.textContent?.trim() || '')
            );
            location = spanTexts.find(text =>
                /^[A-Za-z\s]+,\s?[A-Za-z\s]+$/.test(text) && text.length <= 50
            ) || 'N/A';
        } catch (err) {
            console.error('Failed to extract location:', err);
            location = 'N/A';
        }

        // Extract Email
        let email = '';
        try {
            const pageText = await page.evaluate(() => document.body.innerText);
            const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            email = emailMatch ? emailMatch[0] : '';
        } catch (err) {
            email = '';
        }

        // Extract Username
        let username = '';
        try {
            username = await page.$eval('meta[property="og:title"]', el => el.getAttribute('content') || '') ?? '';
            if (!username) {
                username = await page.title();
            }
            if (username.includes('|')) {
                username = username.split('|')[0].trim();
            } else if (username.includes('-')) {
                username = username.split('-')[0].trim();
            }
        } catch (err) {
            username = '';
        }

        // Extract Social Media Links
        const links = await page.$$eval('a', as => as.map(a => a.href));
        const baseUrl = page.url();

        let instagram = cleanSocialLink(
            links.find(link => link.includes('instagram.com')) || '',
            'instagram',
            baseUrl
        );
        let tiktok = cleanSocialLink(
            links.find(link => link.includes('tiktok.com')) || '',
            'tiktok',
            baseUrl
        );
        let youtube = cleanSocialLink(
            links.find(link => link.includes('youtube.com')) || '',
            'youtube',
            baseUrl
        );
        let twitter = cleanSocialLink(
            links.find(link => link.includes('twitter.com') || link.includes('x.com')) || '',
            'x',
            baseUrl
        );

        try {
            const allLinks = await page.$$eval('a[href]', anchors =>
                anchors.map(a => a.href.toLowerCase())
            );

            for (const link of allLinks) {
                if (!instagram && link.includes('instagram.com')) instagram = link;
                if (!tiktok && link.includes('tiktok.com')) tiktok = link;
                if (!youtube && link.includes('youtube.com')) youtube = link;
                if (!twitter && link.includes('twitter.com')) twitter = link;
            }
        } catch (err) {
            // Leave blank if error occurs
        }

        const isActive = isPostRecent(lastPosted);
        const pageStatus = isActive ? 'Active' : 'Not Active';

        console.log(`Done analyzing: ${url}`);
        return {
            LINK: url,
            USERNAME: username,
            PAGE_NAME: pageName,
            FOLLOWERS: followers,
            PAGEDETAILS: category,
            LAST_POSTED: lastPosted,
            LOCATION: location,
            EMAIL_URL: email,
            INSTAGRAM_URL: instagram,
            TIKTOK_URL: tiktok,
            YOUTUBE_URL: youtube,
            X_URL: twitter,
            PAGE_STATUS: pageStatus
        };

    } catch (err) {
        console.error(`Failed to analyze ${url}:`, err);
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

export async function runScraper(
    links: string[],
    outputFolder: string,
    onProgress?: (progress: ScraperProgress) => void
): Promise<ScraperResult> {
    console.log('Launching browser...');

    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
        ],
        defaultViewport: null
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setJavaScriptEnabled(true);
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });

    console.log('Starting analysis...');
    const results: PageData[] = [];
    const failedLinks: string[] = [];

    for (const [index, link] of links.entries()) {
        console.log(`(${index + 1}/${links.length}) Processing: ${link}`);

        onProgress?.({
            current: index + 1,
            total: links.length,
            currentUrl: link,
            status: 'analyzing'
        });

        const data = await analyzePage(page, link);

        if (data.FOLLOWERS && data.FOLLOWERS !== 'N/A' && data.FOLLOWERS !== 'Error') {
            data.FOLLOWERS = convertFollowers(data.FOLLOWERS);
        }

        results.push(data);

        if (data.PAGE_NAME === 'Error') {
            failedLinks.push(link);
            onProgress?.({
                current: index + 1,
                total: links.length,
                currentUrl: link,
                status: 'error',
                message: 'Failed to analyze page'
            });
        } else {
            onProgress?.({
                current: index + 1,
                total: links.length,
                currentUrl: link,
                status: 'completed'
            });
        }
    }

    await browser.close();
    console.log('Browser closed.');

    // Export to Excel
    console.log('Exporting data to Excel...');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Facebook Pages');

    const headerStyle = {
        font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 14, name: 'Calibri' },
        fill: {
            type: 'pattern' as const,
            pattern: 'solid' as const,
            fgColor: { argb: 'FF1F4E78' }
        },
        alignment: { vertical: 'middle' as const, horizontal: 'center' as const, wrapText: true },
        border: {
            top: { style: 'thick' as const, color: { argb: 'FF000000' } },
            left: { style: 'thick' as const, color: { argb: 'FF000000' } },
            bottom: { style: 'thick' as const, color: { argb: 'FF000000' } },
            right: { style: 'thick' as const, color: { argb: 'FF000000' } }
        }
    };

    const cellStyle: Partial<ExcelJS.Style> = {
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        font: { name: 'Calibri', size: 12 },
        border: {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        }
    };

    const alternatingRowStyle: Partial<ExcelJS.Fill> = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' }
    };

    const pageNameStyle: Partial<ExcelJS.Style> = {
        font: { bold: true, size: 13 },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        }
    };

    sheet.columns = [
        { header: 'PAGE NAME', key: 'PAGE_NAME', width: 40 },
        { header: 'USERNAME', key: 'USERNAME', width: 30 },
        { header: 'LINK', key: 'LINK', width: 50 },
        { header: 'TOTAL FOLLOWERS', key: 'FOLLOWERS', width: 20 },
        { header: 'CLASSIFICATION', key: 'PAGEDETAILS', width: 30 },
        { header: 'LOCATION', key: 'LOCATION', width: 40 },
        { header: 'EMAIL URL', key: 'EMAIL_URL', width: 35 },
        { header: 'INSTAGRAM URL', key: 'INSTAGRAM_URL', width: 50 },
        { header: 'TIKTOK URL', key: 'TIKTOK_URL', width: 50 },
        { header: 'YOUTUBE URL', key: 'YOUTUBE_URL', width: 50 },
        { header: 'X URL', key: 'X_URL', width: 50 },
        { header: 'LAST POSTED', key: 'LAST_POSTED', width: 25 },
        { header: 'PAGE STATUS', key: 'PAGE_STATUS', width: 20 }
    ];

    sheet.getRow(1).eachCell((cell) => {
        Object.assign(cell, headerStyle);
    });

    results.forEach((rowData, rowIndex) => {
        const row = sheet.addRow(rowData);

        if (rowIndex % 2 === 0) {
            row.eachCell((cell) => {
                cell.fill = alternatingRowStyle as ExcelJS.Fill;
            });
        }

        row.eachCell((cell, colIndex) => {
            if (colIndex === 1) {
                Object.assign(cell, pageNameStyle);
            } else {
                Object.assign(cell, cellStyle);
            }
        });

        const statusCell = row.getCell('PAGE_STATUS');
        if (rowData.PAGE_STATUS === 'Active') {
            statusCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF92D050' }
            };
        } else if (rowData.PAGE_STATUS === 'Not Active') {
            statusCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFF5C5C' }
            };
        }
    });

    // Create output folder if it doesn't exist
    if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder, { recursive: true });
    }

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const year = now.getFullYear();
    let hours = now.getHours();
    const minutes = pad(now.getMinutes());
    const seconds = pad(now.getSeconds());
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    const timestamp = `${month}-${day}-${year}_${pad(hours)}-${minutes}-${seconds}_${ampm}`;
    const fileName = `Facebook_Pages_${timestamp}.xlsx`;
    const outputFile = `${outputFolder}/${fileName}`;

    await workbook.xlsx.writeFile(outputFile);
    console.log(`Excel file saved as: ${outputFile}`);

    if (failedLinks.length > 0) {
        console.log(`${failedLinks.length} pages failed to analyze.`);
        fs.writeFileSync(`${outputFolder}/failed_links.txt`, failedLinks.join('\n'), 'utf-8');
    }

    console.log('Done.');

    return {
        outputFile,
        failedCount: failedLinks.length,
        totalProcessed: links.length
    };
}
