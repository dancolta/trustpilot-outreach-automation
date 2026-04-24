/**
 * V13 Email Generation - A/B Testing Framework
 *
 * Generates 3 distinct variants for each email to test which converts best
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

let genAI = null;

function getClient() {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      throw new Error('GEMINI_API_KEY is not configured.');
    }
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

// 3 A/B Test Variants - Each with distinct conversion strategy
const AB_TEST_VARIANTS = {
  A: {
    name: 'Direct Value',
    strategy: 'Lead with specific insight/pattern, offer direct value',
    structure: 'Pattern observation → Specific insight → Quick value offer',
    example: `Sarah,

12 delivery complaints in 60 days. Concentrated in Nov-Dec.

<b><i>"Ordered Nov 20, promised Nov 25. Nothing by Dec 4."</i></b>

Peak season fulfillment. I've seen 3 specific fixes that cut this 70%.

Want the breakdown?`
  },

  B: {
    name: 'Curiosity Gap',
    strategy: 'Create curiosity through specific questions and pattern observation',
    structure: 'Intriguing question → Data point → Pattern insight → Follow-up question',
    example: `Sarah,

What changed between October (4.2★) and December (1.8★)?

<b><i>"Ordered Nov 20, promised Nov 25. Nothing by Dec 4."</i></b>

18 complaints mention Black Friday week specifically.

Seeing the same pattern on your end?`
  },

  C: {
    name: 'Peer Comparison',
    strategy: 'Non-judgmental peer observation, collaborative tone',
    structure: 'Observation → Relatable experience → Collaborative question',
    example: `Sarah,

Noticed 18 delivery issues cluster around holiday weeks.

<b><i>"Ordered Nov 20, promised Nov 25. Nothing by Dec 4."</i></b>

Same thing hit us during peak season - took 3 tries to get it right.

What's your current approach during spikes?`
  }
};

/**
 * Generate email using specific A/B test variant
 */
async function generateVariant(variant, { firstName, reviews, company, reviewsText }) {
  const client = getClient();
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `You are writing a cold email following the "${variant.name}" conversion strategy.

# STRATEGY
${variant.strategy}

# STRUCTURE
${variant.structure}

# EXAMPLE (for style reference only - do NOT copy)
${variant.example}

# REVIEW DATA
Company: ${company}
CEO: ${firstName}
Reviews:
${reviewsText}

# CRITICAL INSTRUCTIONS

1. ANALYZE the reviews and identify:
   - Dominant issue (delivery, refund, wrong items, etc.)
   - Specific count and timeframe
   - Most compelling quote with timeline/specifics
   - Any patterns (seasonal, specific products, etc.)

2. CREATE A COMPLETELY UNIQUE EMAIL:
   - DO NOT copy phrases from the example
   - DO NOT reuse common phrases like "I've tackled similar gaps"
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
   - Subject: 2-3 lowercase words (e.g., "delivery pattern", "peak season", "refund timing")

5. TONE:
   - Natural, conversational
   - No salesy language
   - No generic consultant speak
   - Sound like a peer reaching out
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
 * @returns {Promise<Object|string>} - All 3 variants or single variant
 */
export async function generateEmail({ ceoName, reviews, company, variant = null }) {
  const firstName = ceoName ? ceoName.split(' ')[0] : 'there';

  // Format reviews for analysis
  const reviewsText = reviews
    .slice(0, 10)
    .map((r, i) => `${i + 1}. [${r.rating}★] "${r.title}" - ${r.text}`)
    .join('\n');

  const context = { firstName, reviews, company, reviewsText };

  // Generate single variant if specified
  if (variant && AB_TEST_VARIANTS[variant]) {
    const email = await generateVariant(AB_TEST_VARIANTS[variant], context);
    return email;
  }

  // Generate all 3 variants for A/B testing
  console.log(`  Generating 3 A/B test variants...`);

  const [variantA, variantB, variantC] = await Promise.all([
    generateVariant(AB_TEST_VARIANTS.A, context),
    generateVariant(AB_TEST_VARIANTS.B, context),
    generateVariant(AB_TEST_VARIANTS.C, context)
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
 * Analyze reviews for operational issues
 */
export async function analyzeReviewsWithAI(reviews, company) {
  if (!reviews || reviews.length === 0) {
    return 'No reviews to analyze';
  }

  const client = getClient();
  const model = client.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const reviewText = reviews
    .map((r, i) => `${i + 1}. [${r.rating}★] "${r.title}" - ${r.text}`)
    .join('\n');

  const prompt = `Analyze these Trustpilot reviews for ${company}.

REVIEWS:
${reviewText}

Identify the 2-3 most common OPERATIONAL ISSUES (not emotional complaints).

Focus on:
- Delivery timing problems
- Wrong/damaged items
- Tracking/communication gaps
- Fulfillment errors
- Customer service response time

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
