import { Browser, Page } from 'puppeteer';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Add recaptcha plugin (optional, requires 2captcha API key)
// puppeteer.use(RecaptchaPlugin());

const URL = "https://www.facebook.com/SOICTDigitalMediaPublication";

// Add random delays between actions
const randomDelay = () => new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));

let page: Page;

let browser: Browser;

async function analyzePage(URL: string) {
    try {
        

        // Navigate to the target page
        await page.goto(URL, {
            waitUntil: 'networkidle0',
            timeout: 30000
        });

        try {
            const closeButtonSelector = 'div[role="dialog"] div[aria-label="Close"]';
            await page.waitForSelector(closeButtonSelector, { timeout: 5000 });
            await page.click(closeButtonSelector);
            console.log('Dialog closed successfully.');
        } catch (e) {
            console.log('No dialog appeared.');
        }
        
        // Wait for random time
        await randomDelay();

        const followersLinkSelector = `a[href="${URL}/followers/"]`;
        await page.waitForSelector(followersLinkSelector, { timeout: 10000 });
        const followersText = await page.$eval(followersLinkSelector, el => el.textContent?.trim());
        console.log('Followers Text:', followersText?.split(' ')[0].trim());


        const followingLinkSelector = `a[href="${URL}/following/"]`;
        await page.waitForSelector(followingLinkSelector, { timeout: 10000 });
        const followingText = await page.$eval(followingLinkSelector, el => el.textContent?.trim());
        console.log('Following Text:', followingText?.split(' ')[0].trim());

        const h1Text = await page.$eval('h1.html-h1', el => el.textContent?.trim());
        console.log('Page Name:', h1Text);

        await page.waitForSelector('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', { timeout: 10000 });
        const spanTexts = await page.$$eval('div[data-pagelet="TimelineFeedUnit_0"] span[dir="ltr"]', els =>
            els.map(el => el.textContent?.trim())
        );
        const spanText = spanTexts[1] || '';
        console.log('Last Posted:', spanText.split('·')[0].trim());

        // Close the browser
        await browser.close();

    } catch (error) {
        console.error('Error:', error);
    }
}


async function main(){

    // Launch browser with additional arguments to avoid detection
    browser = await puppeteer.launch({
        headless: false, // Set to true for production
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
        defaultViewport: null,
    });

    page = await browser.newPage();

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Enable JavaScript and cookies
    await page.setJavaScriptEnabled(true);

    // Set additional headers to appear more like a real browser
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    });


    analyzePage(URL);
}



main();
