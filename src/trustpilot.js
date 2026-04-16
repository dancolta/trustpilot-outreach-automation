import puppeteer from 'puppeteer';

const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox'];
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function launchBrowser() {
  return puppeteer.launch({ headless: true, args: BROWSER_ARGS });
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

async function _findTrustpilotPage(browser, website, companyName) {
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);

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

      await page.goto(directUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Check if page exists (not a 404 or search page)
      const pageTitle = await page.title();
      const currentUrl = page.url();

      if (!currentUrl.includes('/search') && !pageTitle.includes('Page not found')) {
        // Verify it's a valid review page by checking for reviews section
        const hasReviews = await page.$('[data-review-id], [class*="review"]');
        if (hasReviews) {
          // Scrape the overall rating
          const rating = await scrapeOverallRating(page);
          return { found: true, url: directUrl, rating };
        }
      }
    }

    // Try search by company name as fallback
    console.log(`  Searching for "${companyName}" on Trustpilot...`);
    const searchUrl = `https://www.trustpilot.com/search?query=${encodeURIComponent(companyName)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });  // Increased from 15s to 30s

    // Get first search result
    const firstResult = await page.$('a[href*="/review/"]');
    if (firstResult) {
      const href = await firstResult.evaluate(el => el.href);
      console.log(`  Found via search: ${href}`);
      // Navigate to the page to get the rating
      await page.goto(href, { waitUntil: 'networkidle2', timeout: 30000 });  // Increased from 15s to 30s
      const rating = await scrapeOverallRating(page);
      return { found: true, url: href, rating };
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
    await page.setUserAgent(USER_AGENT);

    // Navigate to reviews page filtered by star rating
    for (const star of stars) {
      if (reviews.length >= maxReviews) break;

      const reviewUrl = `${url}?stars=${star}`;
      console.log(`  Scraping ${star}-star reviews from: ${reviewUrl}`);

      await page.goto(reviewUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000  // Increased from 30s to 60s
      });

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
