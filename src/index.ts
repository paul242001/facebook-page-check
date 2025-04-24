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
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });

        // Try to close login dialog if it appears
        try {
            const closeButtonSelector = 'div[role="dialog"] div[aria-label="Close"]';
            await page.waitForSelector(closeButtonSelector, { timeout: 3000 });
            await page.click(closeButtonSelector);
        } catch (e) {
            // Dialog didn't appear, ignore
        }

        await randomDelay();


        // ========== Add Random Scroll (Up/Down) ========== 
        await randomScroll(page);

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
            // Select anchor tags that have "followers" in the href and text content
            const followerText = await page.$$eval('a[href*="followers"]', links => {
                for (const link of links) {
                    const text = link.textContent?.trim() || '';
                    if (text.toLowerCase().includes('followers')) {
                        return text;
                    }
                }
                return '';
            });
        
            // Extract the numeric part (e.g. 49K or 36,000)
            const match = followerText.match(/[\d.,KMB]+/i);
            if (match) {
                followers = match[0];
            }
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
let lastPosted = 'Error';
let lastPostedDate: Date | null = null;

try {
    await page.waitForSelector('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', { timeout: 10000 });

    const spanTexts = await page.$$eval('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', els =>
        els.map(el => el.textContent?.trim())
    );

    const rawTimeAgo = (spanTexts[1] || '').split('·')[0].trim();  // e.g., "3w", "17h", "1d"
    lastPosted = rawTimeAgo;

    const now = new Date();
    const regex = /^(\d+)([smhdw])$/i;
    const match = rawTimeAgo.match(regex);

    if (match) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        // Clone current date
        lastPostedDate = new Date(now);

        switch (unit) {
            case 's':
                lastPostedDate.setSeconds(now.getSeconds() - value);
                break;
            case 'm':
                lastPostedDate.setMinutes(now.getMinutes() - value);
                break;
            case 'h':
                lastPostedDate.setHours(now.getHours() - value);
                break;
            case 'd':
                lastPostedDate.setDate(now.getDate() - value);
                break;
            case 'w':
                lastPostedDate.setDate(now.getDate() - (value * 7));
                break;
        }

        // Format to "Month Day" (e.g., "February 22")
        const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
        const formattedDate = lastPostedDate.toLocaleDateString('en-US', options);

        lastPosted = formattedDate;
    } else {
    }

} catch (err) {
    console.warn(`⚠️ Last posted date not found for: ${url}`);
}


        // ========== Extract Social Media Links by Platform ==========
        let location = '';

        try {
            // Wait for any span with dir="auto" to load (in case it's a location)
            await page.waitForSelector('span[dir="auto"]', { timeout: 5000 });
        
            // Get all text contents from span[dir="auto"]
            const spanTexts = await page.$$eval('span[dir="auto"]', spans =>
                spans.map(span => span.textContent?.trim() || '')
            );
        
            // Find a text that looks like a location (e.g., "City, Country")
            location = spanTexts.find(text =>
                /^[A-Za-z\s]+,\s?[A-Za-z\s]+$/.test(text) && text.length <= 50
            ) || 'N/A';
        
        } catch (err) {
            // If any error occurs, default to 'N/A'
            console.error('❌ Failed to extract location:', err);
            location = 'N/A';
        }
        
        
        
        


        let email = '';
        try {
            // Find email using regex search in full text
            const pageText = await page.evaluate(() => document.body.innerText);
            const emailMatch = pageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            email = emailMatch ? emailMatch[0] : '';
        } catch (err) {
            email = '';
        }
        let username = '';

        try {
            const pageUrl = page.url(); // Get the current URL
            const urlMatch = pageUrl.match(/facebook\.com\/([^/?&]+)/i);
        
            if (urlMatch && urlMatch[1]) {
                username = urlMatch[1];
            } else {
                // Fallback: check in meta tags or page content if URL doesn't help
                const html = await page.content();
        
                // Try from canonical link
                const canonicalMatch = html.match(/<link rel="canonical" href="https:\/\/www\.facebook\.com\/([^/?&"]+)/);
                if (canonicalMatch && canonicalMatch[1]) {
                    username = canonicalMatch[1];
                }
            }
        
            // Optional cleanup if needed
            username = username.replace(/\/$/, ''); // remove trailing slash
        } catch (err) {
            console.warn('⚠️ Could not extract real username');
            username = '';
        }
        

        // ========== Extract Contact Number ==========
        let contactNumber = 'N/A';
        try {
            const pageText = await page.evaluate(() => document.body.innerText);
            const phoneMatch = pageText.match(/(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}/);
            contactNumber = phoneMatch ? phoneMatch[0].trim() : 'N/A';
        } catch (err) {
            console.warn(`⚠️ Contact number not found for: ${url}`);
        }
        

        
        // ========== Extract all anchor tags with hrefs ==========
        const links = await page.$$eval('a', as => as.map(a => a.href));

        // ========== Get social media links ==========
        const baseUrl = page.url();  // Get the base URL of the page for relative URLs
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

        // Try to get the links if they weren't found earlier
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
        




        // ========== Determine Page Status ==========
        const isActive = isPostRecent(lastPosted);
        const pageStatus = isActive ? 'Active' : 'Not Active';

        console.log(`✅ Done analyzing: ${url}`);
        return {
            LINK: url,
            USERNAME: username,
            PAGE_NAME: pageName,
            FOLLOWERS: followers,
            PAGEDETAILS: category,
            LAST_POSTED: lastPosted,
            LOCATION: location,
            EMAIL_URL: email,
            CONTACT_NUMBER: contactNumber,
            INSTAGRAM_URL: instagram,
            TIKTOK_URL: tiktok,
            YOUTUBE_URL: youtube,
            X_URL: twitter,
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
function cleanSocialLink(link: string, platform: string, baseUrl: string): string {
    if (link.startsWith('/')) {
        // Handle relative URLs by appending the base URL
        link = new URL(link, baseUrl).href;
    }

    // If the link is obfuscated (e.g., starts with '@l.php'), you might want to clean it
    if (link.includes('@l.php')) {
        // Extract the actual URL, or you can try to process the obfuscated link here
        // For now, just return an empty string if it's obfuscated
        console.warn(`Obfuscated link found for ${platform}: ${link}`);
        return '';
    }

    return link;
}


// Random Scroll Function
async function randomScroll(page: Page) {
    const scrollTimes = 5; // Number of scrolls (10 scrolls)
    const minScrollDelay = 1000; // Minimum delay between scrolls (2 seconds)
    const maxScrollDelay = 2000; // Maximum delay between scrolls (5 seconds)

    for (let i = 0; i < scrollTimes; i++) {
        const direction = Math.random() > 0.5 ? 1 : -1; // Random direction: up or down
        const distance = Math.floor(Math.random() * 300) + 100; // Scroll distance (100px to 400px)

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
  
    // ❌ Case 1: If it's N/A or empty
    if (!trimmed || trimmed === 'n/a') {
      return false;
    }
  
    // ❌ Case 2: If it contains a year (4-digit number)
    if (/\d{4}/.test(trimmed)) {
      return false;
    }
  
    // ❌ Case 3: If the string contains no number (invalid)
    if (!/\d/.test(trimmed)) {
      return false;
    }
  
    // ✅ All other formats (like "March 2", "17h", etc.) are considered Active
    return true;
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
        fs.createReadStream('input/link.csv')
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

    const headerStyle = {
        font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 14, name: 'Calibri' },
        fill: {
            type: 'gradient',
            gradient: 'angle',
            stops: [
                { position: 0, color: { argb: 'FF1F4E78' } }, // Dark blue
                { position: 1, color: { argb: 'FF3E73A8' } }, // Light blue gradient
            ],
        },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: {
            top: { style: 'thick', color: { argb: 'FF000000' } },
            left: { style: 'thick', color: { argb: 'FF000000' } },
            bottom: { style: 'thick', color: { argb: 'FF000000' } },
            right: { style: 'thick', color: { argb: 'FF000000' } }
        }
    };
    
    const cellStyle = {
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        font: { name: 'Calibri', size: 12 },
        border: {
            top: { style: 'thin', color: { argb: 'FF000000' } },
            left: { style: 'thin', color: { argb: 'FF000000' } },
            bottom: { style: 'thin', color: { argb: 'FF000000' } },
            right: { style: 'thin', color: { argb: 'FF000000' } }
        }
    };
    
    // Add shading to every other row to improve readability
    const alternatingRowStyle = {
        fill: {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF2F2F2' } // Light gray background for alternating rows
        }
    };
    
    // Apply larger, bold fonts to page names and important columns
    const pageNameStyle = {
        font: { bold: true, size: 13 },
        alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
        border: {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        }
    };
    
    // Styling the header row
    sheet.columns = [
        { header: 'PAGE NAME', key: 'PAGE_NAME', width: 40, outlineLevel: 1 },
        { header: 'USERNAME', key: 'USERNAME', width: 30 },
        { header: 'LINK', key: 'LINK', width: 50, outlineLevel: 1 },
        { header: 'TOTAL FOLLOWERS', key: 'FOLLOWERS', width: 20, outlineLevel: 1 },
        { header: 'CLASSIFICATION', key: 'PAGEDETAILS', width: 30, outlineLevel: 1 },
        { header: 'LOCATION', key: 'LOCATION', width: 40 },
        { header: 'EMAIL URL', key: 'EMAIL_URL', width: 35 },
        { header: 'CONTACT NUMBER', key: 'CONTACT_NUMBER', width: 25 },
        { header: 'INSTAGRAM URL', key: 'INSTAGRAM_URL', width: 50 },
        { header: 'TIKTOK URL', key: 'TIKTOK_URL', width: 50 },
        { header: 'YOUTUBE URL', key: 'YOUTUBE_URL', width: 50 },
        { header: 'X URL', key: 'X_URL', width: 50 },
        { header: 'LAST POSTED', key: 'LAST_POSTED', width: 25, outlineLevel: 1 },
        { header: 'PAGE STATUS', key: 'PAGE_STATUS', width: 20, outlineLevel: 1 }

    ];
    
    
    // Apply header style
    sheet.getRow(1).eachCell((cell) => {
        Object.assign(cell, headerStyle);
    });
    
    // Add the rows with alternating row styles and custom cell styling
    results.forEach((rowData, rowIndex) => {
        const row = sheet.addRow(rowData);
    
        // Apply alternating row color style
        if (rowIndex % 2 === 0) {
            row.eachCell((cell) => {
                Object.assign(cell, alternatingRowStyle);
            });
        }
    
        // Apply standard cell style
        row.eachCell((cell, colIndex) => {
            // Special style for the Page Name column
            if (colIndex === 1) {
                Object.assign(cell, pageNameStyle);
            } else {
                Object.assign(cell, cellStyle);
            }
        });
    
        // Highlight status with colors
        const statusCell = row.getCell('PAGE_STATUS');
        if (rowData.PAGE_STATUS === 'Active') {
            row.getCell('PAGE_STATUS').fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF92D050' } // green
            };
        } else if (rowData.PAGE_STATUS === 'Not Active') {
            // Highlight the entire row from PAGE_NAME to PAGE_STATUS
            const startColIndex = sheet.getColumn('PAGE_NAME').number;
            const endColIndex = sheet.getColumn('PAGE_STATUS').number;
            for (let i = startColIndex; i <= endColIndex; i++){
                row.getCell(i).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFF5C5C' } // red
            }    
            };
        }
    });

    const now = new Date();

    // Helper to pad numbers
    const pad = (n: number) => n.toString().padStart(2, '0');

    // Get date parts
    const month = pad(now.getMonth() + 1);
    const day = pad(now.getDate());
    const year = now.getFullYear();

     // Get time parts
     let hours = now.getHours();
     const minutes = pad(now.getMinutes());
     const seconds = pad(now.getSeconds());
     const ampm = hours >= 12 ? 'PM' : 'AM';
     hours = hours % 12 || 12;
 
     // Format filename with timestamp
     const timestamp = `${month}-${day}-${year}_${pad(hours)}-${minutes}-${seconds}_${ampm}`;
     const fileName = `output/Facebook-Pages-Distributors${timestamp}.xlsx`;
 
     // Save the workbook
     await workbook.xlsx.writeFile(fileName);
     console.log(`✅ Excel file saved as: ${fileName}`);
 
     // Step 5: Log failed links (if any)
     if (failedLinks.length > 0) {
         console.log(`⚠️ ${failedLinks.length} pages failed to analyze. Writing to failed_links.txt...`);
         fs.writeFileSync('failed_links.txt', failedLinks.join('\n'), 'utf-8');
     } else {
         console.log('🎉 All pages processed successfully without errors.');
     }
 
     console.log('🏁 Done.');
 }
 
 main().catch(err => {
     console.error('❌ Unexpected error in main():', err);
 });
 