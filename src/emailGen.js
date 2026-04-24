/**
 * V14 Email Generation - A/B Testing Framework with Universal Config
 *
 * Generates 3 distinct variants for each email to test which converts best.
 * Now accepts an outreach config (painPoints, offer, tone, reviewFocus) so
 * the same framework works for any industry — not just e-commerce.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI = null;
let cachedKey = null;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured.');
  }
  // Reset client if API key changed (e.g. updated via settings)
  if (!genAI || cachedKey !== apiKey) {
    genAI = new GoogleGenerativeAI(apiKey);
    cachedKey = apiKey;
  }
  return genAI;
}

// 3 A/B Test Variants - Each with distinct conversion strategy
// These are structural/conversion frameworks — industry-agnostic
const AB_TEST_VARIANTS = {
  A: {
    name: 'Direct Value',
    strategy: 'Lead with specific insight/pattern, offer direct value',
    structure: 'Pattern observation → Specific insight → Quick value offer'
  },

  B: {
    name: 'Curiosity Gap',
    strategy: 'Create curiosity through specific questions and pattern observation',
    structure: 'Intriguing question → Data point → Pattern insight → Follow-up question'
  },

  C: {
    name: 'Peer Comparison',
    strategy: 'Non-judgmental peer observation, collaborative tone',
    structure: 'Observation → Relatable experience → Collaborative question'
  }
};

/**
 * Map tone value to a prompt instruction
 */
function getToneInstruction(tone) {
  switch (tone) {
    case 'professional':
      return 'Business-peer tone. Measured, credible, respectful. No slang.';
    case 'direct':
      return 'Blunt, numbers-first. Short punchy sentences. No pleasantries.';
    case 'casual':
    default:
      return 'Natural, conversational. Sound like a real person reaching out. No salesy language.';
  }
}

/**
 * Generate email using specific A/B test variant + outreach config
 */
async function generateVariant(variant, { firstName, reviews, company, reviewsText }, config = {}) {
  const client = getClient();
  const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const { painPoints, offer, tone, reviewFocus } = config;
  const toneInstruction = getToneInstruction(tone);

  // Build the review focus list from config or fall back to generic operational issues
  const focusAreas = reviewFocus && reviewFocus.length > 0
    ? reviewFocus.map(f => `- ${f}`).join('\n')
    : `- Delivery timing problems\n- Wrong/damaged items\n- Tracking/communication gaps\n- Fulfillment errors\n- Customer service response time`;

  // Build sender context section if config is provided
  const senderContext = (painPoints || offer)
    ? `\n# YOUR SERVICE CONTEXT\nWhat you help with: ${painPoints || 'operational issues visible in their reviews'}\nWhat you offer: ${offer || 'a targeted solution'}\nUse this ONLY to frame the CTA naturally — do not make it the email\'s focus.\n`
    : '';

  const prompt = `You are writing a cold email following the "${variant.name}" conversion strategy.

# STRATEGY
${variant.strategy}

# STRUCTURE
${variant.structure}
${senderContext}
# REVIEW DATA
Company: ${company}
CEO: ${firstName}
Reviews:
${reviewsText}

# CRITICAL INSTRUCTIONS

1. ANALYZE the reviews and identify:
   - Dominant issue that matches these focus areas:
${focusAreas}
   - Specific count and timeframe
   - Most compelling quote with timeline/specifics
   - Any patterns (seasonal, specific products, spikes, etc.)
   - IMPORTANT: Only reference reviews from the past 6 months. Do NOT cite older reviews.

2. CREATE A COMPLETELY UNIQUE EMAIL:
   - DO NOT copy any boilerplate phrases or templates
   - Generate fresh, natural language each time
   - Make it sound like a real person wrote it spontaneously

3. FOLLOW THE VARIANT STRATEGY:
   ${variant.name === 'Direct Value' ? `
   - Lead with the pattern you observed
   - Offer something specific (insight, fix, breakdown)
   - Keep the value proposition clear and tangible
   ` : variant.name === 'Curiosity Gap' ? `
   - Start with an intriguing question based on the data
   - Present the pattern as something to explore together
   - End with a question that invites dialogue
   ` : `
   - Frame as peer-to-peer observation
   - Share brief relatable experience (no bragging)
   - Ask about their approach (collaborative, not consultative)
   `}

4. FORMAT REQUIREMENTS:
   - 50-85 words total
   - Use SHORT sentences (10-15 words max per sentence)
   - NO em dashes (—) - use periods, commas, or "and" instead
   - Quote wrapped in <b><i>"quote"</i></b>
   - CRITICAL: Put the final CTA question on its own line (add blank line before it)
   - Subject: 2-3 lowercase words that reflect the actual issue found (not generic)

5. TONE:
   - ${toneInstruction}
   - No generic consultant speak
   - Keep it punchy and direct

# OUTPUT FORMAT
Subject: [subject]

[email body]

Generate now with completely fresh language:`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

/**
 * Generate all 3 A/B test variants for a single lead
 *
 * @param {Object} params
 * @param {string} params.ceoName - CEO full name
 * @param {Array} params.reviews - Array of review objects
 * @param {string} params.company - Company name
 * @param {string} params.variant - Optional: 'A', 'B', or 'C' to generate single variant
 * @param {Object} params.config - Outreach config: { painPoints, offer, tone, reviewFocus }
 * @returns {Promise<Object|string>} - All 3 variants or single variant
 */
export async function generateEmail({ ceoName, reviews, company, variant = null, config = {} }) {
  const firstName = ceoName ? ceoName.split(' ')[0] : 'there';

  // Filter to reviews from the past 6 months only, then format for analysis
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const recentReviews = reviews.filter(r => {
    if (!r.date) return true; // keep reviews without dates as fallback
    const d = new Date(r.date);
    return !isNaN(d.getTime()) && d >= sixMonthsAgo;
  });

  const reviewsToUse = recentReviews.length > 0 ? recentReviews : reviews;
  const reviewsText = reviewsToUse
    .slice(0, 10)
    .map((r, i) => `${i + 1}. [${r.rating}★] ${r.date ? `(${r.date}) ` : ''}"${r.title}" - ${r.text}`)
    .join('\n');

  const context = { firstName, reviews, company, reviewsText };

  // Generate single variant if specified
  if (variant && AB_TEST_VARIANTS[variant]) {
    const email = await generateVariant(AB_TEST_VARIANTS[variant], context, config);
    return email;
  }

  // Generate all 3 variants for A/B testing
  console.log(`  Generating 3 A/B test variants...`);

  const [variantA, variantB, variantC] = await Promise.all([
    generateVariant(AB_TEST_VARIANTS.A, context, config),
    generateVariant(AB_TEST_VARIANTS.B, context, config),
    generateVariant(AB_TEST_VARIANTS.C, context, config)
  ]);

  return {
    company,
    ceoName: firstName,
    variants: {
      A: {
        strategy: AB_TEST_VARIANTS.A.name,
        email: variantA
      },
      B: {
        strategy: AB_TEST_VARIANTS.B.name,
        email: variantB
      },
      C: {
        strategy: AB_TEST_VARIANTS.C.name,
        email: variantC
      }
    }
  };
}

/**
 * Analyze reviews for operational issues matching the provided config
 *
 * @param {Array} reviews
 * @param {string} company
 * @param {Object} config - { painPoints, offer, tone, reviewFocus }
 */
export async function analyzeReviewsWithAI(reviews, company, config = {}) {
  if (!reviews || reviews.length === 0) {
    return 'No reviews to analyze';
  }

  const client = getClient();
  const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const reviewText = reviews
    .map((r, i) => `${i + 1}. [${r.rating}★] "${r.title}" - ${r.text}`)
    .join('\n');

  const { reviewFocus } = config;
  const focusAreas = reviewFocus && reviewFocus.length > 0
    ? reviewFocus.map(f => `- ${f}`).join('\n')
    : `- Delivery timing problems\n- Wrong/damaged items\n- Tracking/communication gaps\n- Fulfillment errors\n- Customer service response time`;

  const prompt = `Analyze these Trustpilot reviews for ${company}.

REVIEWS:
${reviewText}

Identify the 2-3 most common OPERATIONAL ISSUES (not emotional complaints).

Focus specifically on:
${focusAreas}

Frame as operational patterns, not technical jargon:
- GOOD: "Late deliveries, averaging 2+ weeks"
- BAD: "OMS transit time calculation failure"
- GOOD: "Wrong items shipped repeatedly"
- BAD: "Warehouse pick-and-pack workflow failure"

Respond with 2-3 patterns, comma-separated. Be specific about WHAT is happening, not WHY.`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error(`  Error analyzing reviews: ${error.message}`);
    return 'Unable to analyze';
  }
}
