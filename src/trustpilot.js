import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--lang=en-US,en',
];
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

function launchBrowser() {
  return puppeteerExtra.launch({
    headless: true,
    args: BROWSER_ARGS,
    defaultViewport: { width: 1440, height: 900 },
  });
}

async function primePage(page) {
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });
}

/**
 * Run find + scrape in a single browser session (avoids double launch per company).
 */
export async function findAndScrape(website, companyName, stars = [1, 2], maxReviews = 20) {
  const browser = await launchBrowser();
  try {
    const trustpilot = await _findTrustpilotPage(browser, website, companyName);
    if (!trustpilot.found) return { trustpilot, reviews: [] };
    const reviews = await _scrapeReviews(browser, trustpilot.url, stars, maxReviews);
    return { trustpilot, reviews };
  } finally {
    await browser.close();
  }
}

/**
 * Scrape overall company rating from a Trustpilot page
 * @param {Page} page - Puppeteer page object
 * @returns {Promise<number|null>} - Rating as float (e.g., 3.7) or null
 */
async function scrapeOverallRating(page) {
  try {
    const rating = await page.evaluate(() => {
      // Try multiple selectors for the rating
      const ratingSelectors = [
        '[data-rating-typography="true"]',
        '.star-rating span',
        '[class*="ratingValue"]',
        'p[data-rating-typography]',
        '.styles_ratingValue__YAFOJ'
      ];

      for (const selector of ratingSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.textContent.trim();
          const parsed = parseFloat(text);
          if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
            return parsed;
          }
        }
      }

      // Try to find rating in meta tags or JSON-LD
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          if (data.aggregateRating?.ratingValue) {
            return parseFloat(data.aggregateRating.ratingValue);
          }
        } catch {}
      }

      return null;
    });

    if (rating) {
      console.log(`  Overall Trustpilot rating: ${rating}`);
    }
    return rating;
  } catch (error) {
    console.error(`  Error scraping rating: ${error.message}`);
    return null;
  }
}

async function _googleFallback(page, companyName) {
  try {
    const q = encodeURIComponent(`site:trustpilot.com/review ${companyName}`);
    const url = `https://www.google.com/search?q=${q}&hl=en`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const href = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a'));
      for (const a of anchors) {
        const h = a.href || '';
        const m = h.match(/https?:\/\/[^\/]*trustpilot\.com\/review\/[^\s?&#"']+/);
        if (m) return m[0];
      }
      return null;
    });
    return href;
  } catch {
    return null;
  }
}

async function _warmUp(page) {
  // Trustpilot uses AWS WAF: first request returns 403 and sets aws-waf-token;
  // subsequent requests with that cookie succeed.
  try {
    await page.goto('https://www.trustpilot.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));
  } catch {}
}

async function _gotoWithRetry(page, url, maxAttempts = 3) {
  let lastResp = null;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      lastResp = resp;
      const status = resp?.status() ?? 0;
      if (status && status < 400) return resp;
      if (status === 403 && i < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
        continue;
      }
      return resp;
    } catch (err) {
      if (i === maxAttempts - 1) throw err;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  return lastResp;
}

async function _findTrustpilotPage(browser, website, companyName) {
  try {
    const page = await browser.newPage();
    await primePage(page);
    await _warmUp(page);

    // Extract domain from website — skip social media URLs (LinkedIn, Facebook, Twitter, etc.)
    let domain = '';
    const socialDomains = ['linkedin.com', 'facebook.com', 'twitter.com', 'instagram.com', 'tiktok.com', 'youtube.com'];
    let isSocialUrl = false;
    try {
      const url = new URL(website.startsWith('http') ? website : `https://${website}`);
      domain = url.hostname.replace('www.', '');
      isSocialUrl = socialDomains.some(s => domain.includes(s));
    } catch {
      domain = website.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      isSocialUrl = socialDomains.some(s => domain.includes(s));
    }

    if (isSocialUrl) {
      console.log(`  Skipping social media URL (${domain}), searching by company name instead...`);
      domain = '';
    }

    // Try direct Trustpilot URL with domain (skip if no valid domain)
    if (domain) {
      const directUrl = `https://www.trustpilot.com/review/${domain}`;
      console.log(`  Trying: ${directUrl}`);

      const resp = await _gotoWithRetry(page, directUrl).catch(() => null);
      const status = resp?.status() ?? 0;

      if (status && status < 400) {
        // Give reviews a moment to render
        await page.waitForSelector('[data-review-id], [class*="reviewCard"], script[type="application/ld+json"]', { timeout: 8000 }).catch(() => {});
        const pageTitle = await page.title();
        const currentUrl = page.url();

        if (!currentUrl.includes('/search') && !pageTitle.includes('Page not found')) {
          const hasReviews = await page.$('[data-review-id], [class*="review"]');
          if (hasReviews) {
            const rating = await scrapeOverallRating(page);
            return { found: true, url: directUrl, rating };
          }
        }
      } else {
        console.log(`  Direct URL returned status ${status}`);
      }
    }

    // Fallback 1: Trustpilot's own search
    console.log(`  Searching for "${companyName}" on Trustpilot...`);
    const searchUrl = `https://www.trustpilot.com/search?query=${encodeURIComponent(companyName)}`;
    const searchResp = await _gotoWithRetry(page, searchUrl).catch(() => null);

    if (searchResp && searchResp.status() < 400) {
      await page.waitForSelector('a[href*="/review/"]', { timeout: 8000 }).catch(() => {});
      const firstResult = await page.$('a[href*="/review/"]');
      if (firstResult) {
        const href = await firstResult.evaluate(el => el.href);
        console.log(`  Found via Trustpilot search: ${href}`);
        await _gotoWithRetry(page, href);
        await page.waitForSelector('[data-review-id], [class*="reviewCard"]', { timeout: 8000 }).catch(() => {});
        const rating = await scrapeOverallRating(page);
        return { found: true, url: href, rating };
      }
    }

    // Fallback 2: Google site search (works when Trustpilot blocks us)
    console.log(`  Trying Google fallback for "${companyName}"...`);
    const googleHit = await _googleFallback(page, companyName);
    if (googleHit) {
      console.log(`  Found via Google: ${googleHit}`);
      await page.goto(googleHit, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
      await page.waitForSelector('[data-review-id], [class*="reviewCard"]', { timeout: 8000 }).catch(() => {});
      const hasReviews = await page.$('[data-review-id], [class*="review"]');
      if (hasReviews) {
        const rating = await scrapeOverallRating(page);
        return { found: true, url: googleHit, rating };
      }
    }

    return { found: false, url: null, rating: null };

  } catch (error) {
    console.error(`  Error searching Trustpilot: ${error.message}`);
    return { found: false, url: null, rating: null };
  }
}

async function _scrapeReviews(browser, url, stars = [1, 2], maxReviews = 20) {
  const reviews = [];

  try {
    const page = await browser.newPage();
    await primePage(page);
    await _warmUp(page);

    // Navigate to reviews page filtered by star rating
    for (const star of stars) {
      if (reviews.length >= maxReviews) break;

      const reviewUrl = `${url}?stars=${star}`;
      console.log(`  Scraping ${star}-star reviews from: ${reviewUrl}`);

      await _gotoWithRetry(page, reviewUrl);

      // Wait for reviews to load
      await page.waitForSelector('[data-review-id], [class*="reviewCard"]', { timeout: 15000 }).catch(() => {  // Increased from 10s to 15s
        console.log(`  No ${star}-star reviews found`);
      });

      // Extract reviews from the page
      const pageReviews = await page.evaluate((starRating) => {
        const reviewElements = document.querySelectorAll('[data-review-id], [class*="reviewCard"]');
        const extracted = [];

        reviewElements.forEach(el => {
          // Get review title
          const titleEl = el.querySelector('[data-consumer-review-title], h2, [data-service-review-title-typography]');
          const title = titleEl?.textContent?.trim() || '';

          // Get review text
          const textEl = el.querySelector('[data-consumer-review-text], [data-service-review-text-typography], p[class*="text"]');
          const text = textEl?.textContent?.trim() || '';

          // Get date
          const dateEl = el.querySelector('time');
          const date = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || '';

          if (title || text) {
            extracted.push({
              rating: starRating,
              title,
              text,
              date
            });
          }
        });

        return extracted;
      }, star);

      reviews.push(...pageReviews);

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

  } catch (error) {
    console.error(`  Error scraping reviews: ${error.message}`);
  }

  // Filter to reviews from the past 6 months only
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const recentReviews = reviews.filter(r => {
    if (!r.date) return false;
    const reviewDate = new Date(r.date);
    return !isNaN(reviewDate.getTime()) && reviewDate >= sixMonthsAgo;
  });

  console.log(`  Filtered to ${recentReviews.length} reviews from past 6 months (of ${reviews.length} total)`);
  return recentReviews.slice(0, maxReviews);
}

// Public wrappers that manage their own browser (for standalone use)
export async function findTrustpilotPage(website, companyName) {
  const browser = await launchBrowser();
  try {
    return await _findTrustpilotPage(browser, website, companyName);
  } finally {
    await browser.close();
  }
}

export async function scrapeReviews(url, stars = [1, 2], maxReviews = 20) {
  const browser = await launchBrowser();
  try {
    return await _scrapeReviews(browser, url, stars, maxReviews);
  } finally {
    await browser.close();
  }
}

/**
 * Analyze reviews to extract common pain points
 * @param {Array<{rating: number, title: string, text: string, date: string}>} reviews
 * @returns {string} - Comma-separated list of pain points
 */
export function extractPainPoints(reviews) {
  if (!reviews || reviews.length === 0) {
    return 'No reviews found';
  }

  // Combine all review text for analysis
  const combinedText = reviews
    .map(r => `${r.title} ${r.text}`)
    .join(' ')
    .toLowerCase();

  // Common pain point categories and keywords
  const painPointCategories = {
    'Customer Service Issues': ['customer service', 'support', 'response time', 'no reply', 'unhelpful', 'rude', 'ignored'],
    'Delivery Problems': ['delivery', 'shipping', 'late', 'never arrived', 'wrong item', 'damaged', 'packaging'],
    'Product Quality': ['quality', 'defective', 'broken', 'cheap', 'not as described', 'fake', 'counterfeit'],
    'Refund/Return Issues': ['refund', 'return', 'money back', 'no refund', 'cancellation', 'charged'],
    'Communication Problems': ['communication', 'email', 'contact', 'phone', 'reach', 'respond'],
    'Website/Tech Issues': ['website', 'app', 'technical', 'bug', 'error', 'crash', 'slow'],
    'Pricing Issues': ['price', 'expensive', 'overpriced', 'hidden fees', 'charged more'],
  };

  const detectedPainPoints = [];

  for (const [category, keywords] of Object.entries(painPointCategories)) {
    const matchCount = keywords.filter(kw => combinedText.includes(kw)).length;
    if (matchCount >= 2) {
      detectedPainPoints.push(category);
    }
  }

  if (detectedPainPoints.length === 0) {
    return `General dissatisfaction (${reviews.length} negative reviews found)`;
  }

  return detectedPainPoints.join(', ');
}
