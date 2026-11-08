# Product enrichment

Paste one link → Find product details → review/correct suggestions → Save to library. The original affiliate URL is kept as the publishing destination, including attribution parameters. A database trigger prevents subsequent replacement of its identity.

## Current capability and limits

- Embedded destinations in documented ShopMy `apx/...?...url=...` links are decoded locally. No ShopMy request is needed.
- An opaque `p-ID` requires a destination resolver or a licensed product mapping. No resolver is currently configured for ShopMy. This is a configuration/authorization uncertainty, not a claim that URL parsing is prohibited.
- Redirect adapters support individual HEAD requests only for origins and paths with recorded current authorization. Every hop is checked; credentials/cookies and arbitrary APIs are not used. A public redirect response does not itself authorize a subsequent metadata fetch.
- Licensed feed adapters match exact affiliate IDs/URLs or retailer URLs. They do not guess products from names. Awin/CJ records generally do not contain ShopMy IDs, so a retailer URL/SKU mapping may still be necessary.
- Permitted-page adapters parse Open Graph and Product JSON-LD without executing JavaScript. Recorded access scope is checked before fetching; robots restrictions and 401/403/429 responses are respected. HTTP redirects during metadata retrieval are not followed automatically. Images are returned only under a license covering republication. Public metadata alone does not establish such a license.
- Manual details remain optional fallback. Existing edits are not overwritten by source checks. Retrieved values await review and never approve or publish Pins.

## Authorization configuration

`PINBOT_ENRICHMENT_GRANTS` is a server-only JSON array. It records a supported access basis, such as published API documentation or merchant permission, not necessarily bespoke written permission for every source. Do not enable a source based solely on absence of a prohibition. Confirmed restrictions, ambiguity, and configured permitted access should be recorded separately during source onboarding.

Example shape (illustrative; not a grant for example.com):

```json
[{
  "origin": "https://example.com",
  "pathPrefix": "/products",
  "purpose": "metadata",
  "authorizationReference": "Merchant agreement or documented access policy reference",
  "expiresAt": "2027-01-01T00:00:00Z",
  "permitsShopMyDestination": true,
  "imagesMayBeRepublished": true
}]
```

Purpose can be `redirect`, `metadata`, or `feed`. There are no default grants. Requests have bounded bodies/timeouts, HTTPS only, exact origin/path checks, pinned DNS, public IPv4 validation, and no forwarded browser cookies or authentication. There are no unattended jobs.

## Licensed normalized feed adapter

`PINBOT_LICENSED_PRODUCT_FEEDS` accepts a small deployment-managed JSON catalog. Large network feeds should be normalized into a database-backed provider implementing `MetadataProvider`; don't put large feeds in environment variables. The adapter is functional without contacting retailer or ShopMy sites. Keep the source's license/reference and attribution requirements alongside its records.

```json
[{
  "id": "merchant-catalog",
  "authorizationReference": "Reference to the approved feed agreement",
  "expiresAt": "2027-01-01T00:00:00Z",
  "permitsShopMyDestination": true,
  "imagesMayBeRepublished": true,
  "records": [{
    "product_url": "https://example.com/products/product",
    "product_name": "Product name",
    "retailer": "Retailer",
    "image_url": "https://example.com/images/product.jpg"
  }]
}]
```

Each record needs an exact `product_url`, `affiliate_url`, or `source_key` match. Multiple matches are rejected. No commercial provider has been connected or claimed to cover Klassy.

## Data and status

Apply migration `202611080002_modular_enrichment.sql` before deploying these changes. It preserves existing product fields and moves incomplete imports to pending/partial. The current p-101876060 entry is not considered complete without product metadata.

Statuses: `pending` (identity/source/access missing), `partial` (some metadata available), `review_required` (complete suggestions awaiting review), `manual` (complete details explicitly reviewed). Machine-readable attempt codes distinguish missing resolver/configuration, no match, ambiguous match, permission scope, robots restrictions, source denials, rate limits, timeouts and unavailable metadata. Field provenance includes provider, method, retrieval time and authorization reference. Use the library's Lookup status for explanations.

A user-triggered preview handles one link. Bulk save stores links safely first and checks at most one immediately; others remain pending for explicit checks. Duplicate imports do not overwrite existing metadata. Enrichment writes use optimistic concurrency and saved-item retries have a cooldown.

## Documented provider options investigated

- Awin publisher feeds provide product URLs, names/descriptions and images: https://help.awin.com/developers/docs/product-feed-publisher-guide-intro . Access depends on the available advertiser feeds and publisher account. Review the permitted use with ShopMy attribution before connecting.
- CJ Product Feed API supports publisher product queries using a Personal Access Token, company ID and advertiser IDs: https://docs.cj.com/docs/productfeed-api-search . Product identity/retailer coverage and reuse rights require verification.

These are supported product-data products, not universal URL-unfurling services. Neither is connected yet, and their tracking links must not replace the user's original ShopMy affiliate URL.
