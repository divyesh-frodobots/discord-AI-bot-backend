import crypto from 'crypto';
import googleSheets from '../services/GoogleSheetsService.js';

// --- HMAC verification ---
function verifyShopifyHmac(rawBody, secret, hmacHeader) {
  if (!rawBody || !secret || !hmacHeader) return false;
  try {
    const computed = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    const a = Buffer.from(hmacHeader, 'base64');
    const b = Buffer.from(computed, 'base64');

    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// --- Extract Google Sheets row ---
function determineBotModel(order) {
  const items = order?.line_items || [];
  const normalize = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9+\s-]/g, '');

  for (const item of items) {
    const candidates = [item?.title, item?.variant_title];
    for (const c of candidates) {
      const t = normalize(c);
      if (!t) continue;
      if (t.includes('mini+') || t.includes('mini plus') || t.includes('mini-plus') || t.includes('miniplus')) {
        return 'Mini+';
      }
      if (t.includes('mini')) {
        return 'Mini';
      }
      if (t.includes('zero')) {
        return 'Zero';
      }
    }
  }
  return '';
}

function normalizeCountryForSheet(order) {
  const addr = order?.shipping_address || order?.customer?.default_address || {};
  const code = (addr.country_code || addr.country_code_alpha2 || '').toUpperCase();
  const name = (addr.country || '').trim();

  // Map by ISO country code → dropdown label
  const mapByCode = {
    US: 'USA',
    AU: 'Australia',
    AT: 'Austria',
    BE: 'Belgium',
    CA: 'Canada',
    CH: 'Switzerland',
    CN: 'China',
    CZ: 'Czech Republic',
    DE: 'Germany',
    ES: 'Spain',
    FI: 'Finland',
    FR: 'France',
    GB: 'UK',
    GR: 'Greece',
    HU: 'Hungary',
    ID: 'Indonesia',
    IN: 'India',
    IT: 'Italy',
    JP: 'Japan',
    KE: 'Kenya',
    KR: 'South Korea',
    LT: 'Lithuania',
    LV: 'Latvia',
    MY: 'Malaysia',
    NG: 'Nigeria',
    NL: 'Netherlands',
    NO: 'Norway',
    NZ: 'New Zealand',
    PH: 'Philippines',
    PT: 'Portugal',
    RO: 'Romania',
    SE: 'Sweden',
    SG: 'Singapore',
    SK: 'Slovakia',
    SI: 'Slovenia',
    TW: 'Taiwan',
    TH: 'Thailand',
    AE: 'Dubai', // Business rule: map UAE orders to "Dubai" entry
  };

  if (mapByCode[code]) return mapByCode[code];

  // Fallbacks based on common country names/synonyms
  const lowered = name.toLowerCase();
  if (['united states', 'united states of america', 'usa'].includes(lowered)) return 'USA';
  if (['united kingdom', 'great britain', 'gb', 'uk'].includes(lowered)) return 'UK';
  if (['republic of korea', 'korea, republic of', 'south korea'].includes(lowered)) return 'South Korea';
  if (['united arab emirates', 'uae', 'u.a.e.'].includes(lowered)) return 'Dubai';
  if (['cote d\'ivoire', "côte d'ivoire"].includes(lowered)) return "Cote d'Ivoire"; // example of normalization
  if (name) return name; // leave as-is for other countries present in dropdown
  return '';
}

function extractRowFromOrder(order) {
  const first = order?.customer?.first_name || '';
  const last = order?.customer?.last_name || '';
  const customerName = `${first} ${last}`.trim();
  const email = order?.email || order?.customer?.email || '';
  const purchaseDate = (order?.created_at || '').slice(0, 10);
  const country = normalizeCountryForSheet(order);
  const botModel = determineBotModel(order); // Allowed values: zero | mini | mini+

  return [
    customerName, // A Customer Name
    '',           // B Remarks
    email,        // C Shopify Email
    purchaseDate, // D Purchase Date
    country,      // E Location (Country)
    botModel,     // F Bot Model
    '', '', '', '', '' // G..K placeholders for other columns
  ];
}

// --- Webhook handler ---
export async function handleOrdersCreate(req, res) {
  try {
    if (process.env.DEBUG_WEBHOOKS === 'true') {
      console.log('🪝 [Webhook] Incoming orders/create');
      console.log('🪝 Headers:', {
        'X-Shopify-Topic': req.get('X-Shopify-Topic'),
        'X-Shopify-Shop-Domain': req.get('X-Shopify-Shop-Domain'),
        'Content-Type': req.get('content-type'),
      });
    }

    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const rawBody = req.rawBody; // always use raw body, not parsed
    console.log('🪝 Raw body:', rawBody);

    if (process.env.DEBUG_WEBHOOKS === 'true') {
      const bodyLen = Buffer.isBuffer(rawBody) ? rawBody.length : (rawBody?.length || 0);
      console.log('🪝 Secret present:', Boolean(secret));
      console.log('🪝 Body length:', bodyLen);

      try {
        if (secret && rawBody) {
          const computed = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
          const hdrPrefix = (hmacHeader || '').slice(0, 12);
          const cmpPrefix = computed.slice(0, 12);
          console.log(`🪝 HMAC hdr prefix: ${hdrPrefix}..., computed prefix: ${cmpPrefix}...`);
        }
      } catch {}
    }

    if (!verifyShopifyHmac(rawBody, secret, hmacHeader)) {
      if (process.env.DEBUG_WEBHOOKS === 'true') {
        console.log('🪝 [Webhook] HMAC verification failed');
      }
      return res.status(401).send('Invalid HMAC');
    }

    // rawBody is a string/buffer → parse JSON now
    const order = JSON.parse(rawBody.toString('utf8'));
    console.log('🪝 Order:', order);
    const row = extractRowFromOrder(order);

    await googleSheets.appendRow(row);

    if (process.env.DEBUG_WEBHOOKS === 'true') {
      console.log('🪝 [Webhook] Appended row to Google Sheet');
    }

    return res.status(200).send('ok');
  } catch (e) {
    console.error('❌ Shopify orders/create webhook error:', e);
    return res.status(500).send('error');
  }
}
