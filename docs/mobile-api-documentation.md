# Shathi Sheba Mobile App API Documentation

Version: 1.0  
Prepared for: Mobile app implementation agent  
Backend app: Shathi Sheba Admin / API Backend  
Current API root: `/api/v1`

## 1. Purpose

This document describes the API currently exposed by the Shathi Sheba Admin project for the mobile app. The same backend is used by the admin UI to create, read, update, and delete application data in MySQL.

The mobile app can use these APIs for:

- Splash/onboarding interest categories
- Registered app users and profile data
- Weather and market updates
- Sell-from-farmer listing flow
- Buy-from-Shathi product catalog and order flow
- Learning CMS content
- Partner project registration and KYC flow
- Community feed, comments, and reports
- Notifications and operational support data

## 2. Base URL

Use the deployed domain in production.

```txt
Production: https://<your-domain>/api/v1
Local:      http://localhost:3000/api/v1
```

Examples in this document use relative URLs such as:

```txt
/api/v1/users
/api/v1/sale/listings/1
```

## 3. Current API Status

The API route is implemented in:

```txt
app/api/v1/[...resource]/route.ts
```

Database resource mappings are implemented in:

```txt
lib/db-resources.ts
```

The API supports:

```txt
GET     /api/v1/{resource}
POST    /api/v1/{resource}
GET     /api/v1/{resource}/{id}
PATCH   /api/v1/{resource}/{id}
PUT     /api/v1/{resource}/{id}
DELETE  /api/v1/{resource}/{id}
```

For compatibility with the admin app, detail/update/delete also supports query string IDs:

```txt
GET     /api/v1/users?id=5
PATCH   /api/v1/users?id=5
DELETE  /api/v1/users?id=5
```

Preferred mobile-app style:

```txt
GET     /api/v1/users/5
PATCH   /api/v1/users/5
DELETE  /api/v1/users/5
```

## 4. Response Envelope

Most successful `GET` responses use this envelope:

```json
{
  "ok": true,
  "generated_at": "2026-05-13T06:22:14.590Z",
  "meta": {
    "source": "mysql",
    "resource": "users"
  },
  "data": []
}
```

Detail responses use:

```json
{
  "ok": true,
  "generated_at": "2026-05-13T06:22:14.590Z",
  "meta": {
    "source": "mysql",
    "resource": "users",
    "id": "5"
  },
  "data": {
    "row": {},
    "related": {}
  }
}
```

Mutation responses use:

```json
{
  "ok": true,
  "source": "mysql",
  "action": "created",
  "resource": "users",
  "result": {
    "insertId": 6,
    "affectedRows": 1
  }
}
```

Error responses use:

```json
{
  "ok": false,
  "message": "Missing id for update."
}
```

Database errors use:

```json
{
  "ok": false,
  "message": "Duplicate entry '01712-345678' for key 'app_users.phone'",
  "source": "mysql"
}
```

## 5. Authentication Note

> **Superseded — this section is out of date.** `/api/v1` has enforced
> authentication since 2026-08-13. Every route requires a caller: the mobile app
> sends `Authorization: Bearer <token>` resolved against `app_sessions`, and the
> admin console is recognised by its `admin_session` cookie. Resources are
> default-deny — only reference data and the OTP handshake are reachable without
> a session. A user's `user_id` is derived from that session and a client-supplied
> value is overwritten, not trusted. See `SECURITY.md` for the current contract.
>
> The original note is kept below for historical context only.

The current route does not enforce authentication yet. Before production mobile release, add one of these:

- Bearer token for mobile users
- Session/JWT user authentication
- Admin-only token for admin CRUD routes
- Rate limiting for public endpoints

Recommended future header:

```http
Authorization: Bearer <token>
Content-Type: application/json
Accept: application/json
```

## 6. API Discovery

### GET `/api/v1/catalog`

Returns the documented endpoints and database-backed resources.

Example:

```bash
curl http://localhost:3000/api/v1/catalog
```

Response shape:

```json
{
  "ok": true,
  "data": {
    "endpoints": [
      {
        "method": "GET",
        "path": "/api/v1/interests",
        "desc": "Splash onboarding categories and nested items"
      }
    ],
    "database_resources": [
      {
        "resource": "users",
        "collection": "/api/v1/users",
        "detail": "/api/v1/users/{id}",
        "methods": ["GET", "POST", "PATCH", "PUT", "DELETE"]
      }
    ]
  }
}
```

## 7. Mobile App Screen Mapping

Use this section as the mobile app routing guide.

| Mobile feature | Primary endpoints |
|---|---|
| Splash/onboarding interests | `GET /api/v1/interests`, `POST /api/v1/user/interests` |
| User profile | `GET /api/v1/users/{id}`, `POST /api/v1/users`, `PATCH /api/v1/users/{id}` |
| Weather cards/alerts | `GET /api/v1/weather` |
| Home market updates | `GET /api/v1/market-updates` |
| Sell landing/setup | `GET /api/v1/sale/categories`, `GET /api/v1/sale/items`, `GET /api/v1/sale/breeds`, `GET /api/v1/sale/pricing` |
| Farmer sale listings | `GET /api/v1/sale/listings`, `POST /api/v1/sale/listings`, `PATCH /api/v1/sale/listings/{id}` |
| Buy catalog | `GET /api/v1/buy/categories`, `GET /api/v1/buy/products` |
| Product orders | `POST /api/v1/buy/orders`, `GET /api/v1/buy/orders/{id}`, `GET /api/v1/orders/items` |
| Learning home | `GET /api/v1/learning/categories`, `GET /api/v1/learning/modules`, `GET /api/v1/learning/contents` |
| Learning progress | `POST /api/v1/learning/progress`, `PATCH /api/v1/learning/progress/{user_id}` |
| Partner projects | `GET /api/v1/partners/projects`, `POST /api/v1/partners/applications` |
| Partner KYC/application | `GET /api/v1/partners/applications/{id}`, `PATCH /api/v1/partners/applications/{id}` |
| Community feed | `GET /api/v1/community/posts`, `POST /api/v1/community/posts` |
| Community comments | `GET /api/v1/community/comments`, `POST /api/v1/community/comments` |
| Notifications | `GET /api/v1/notifications/campaigns` |

## 8. Core Mobile Endpoints

### 8.1 Users

Resource:

```txt
users
```

Database table:

```txt
app_users
```

Endpoints:

```txt
GET     /api/v1/users
POST    /api/v1/users
GET     /api/v1/users/{id}
PATCH   /api/v1/users/{id}
PUT     /api/v1/users/{id}
DELETE  /api/v1/users/{id}
```

Allowed create/update fields:

```txt
full_name
display_name
phone
email
gender
date_of_birth
district
upazila
union_name
village
latitude
longitude
status
profile_json
```

Field aliases accepted:

```txt
name -> full_name
```

Create user request:

```json
{
  "full_name": "Ramim",
  "display_name": "Ramim",
  "phone": "01966662633",
  "email": "ramim@example.com",
  "gender": "male",
  "district": "Jheneidah",
  "upazila": "Moheshpur",
  "status": "active",
  "profile_json": {
    "primary_work": "livestock",
    "language": "bn"
  }
}
```

Detail response example:

```json
{
  "ok": true,
  "generated_at": "2026-05-13T06:22:14.590Z",
  "meta": {
    "source": "mysql",
    "resource": "users",
    "id": "5"
  },
  "data": {
    "row": {
      "id": 5,
      "full_name": "Ramim",
      "display_name": "Ramim",
      "phone": "01966662633",
      "email": "ramim@example.com",
      "district": "Jheneidah",
      "upazila": "Moheshpur",
      "status": "active"
    },
    "related": {}
  }
}
```

Mobile notes:

- `phone` is unique.
- Use `status=active` for usable app users.
- `profile_json` can store flexible app preferences.

### 8.2 Interest Categories

Resource:

```txt
interests
```

Database table:

```txt
interest_categories
```

Endpoints:

```txt
GET     /api/v1/interests
POST    /api/v1/interests
GET     /api/v1/interests/{id}
PATCH   /api/v1/interests/{id}
DELETE  /api/v1/interests/{id}
```

Allowed fields:

```txt
parent_id
slug
name_en
name_bn
description_en
description_bn
emoji
sort_order
step_group
is_selectable
is_active
```

List response rows include:

```json
{
  "id": "1",
  "name": "Cow Cattle & Poultry",
  "bangla": "Cattle and poultry Bangla label",
  "items": "Cow, Goat, Chicken, Duck",
  "slug": "livestock-poultry",
  "status": "Active"
}
```

Mobile use:

- Show root categories first.
- Child items are represented in the `items` aggregate in the current list response.
- For a full tree, the backend should later add a dedicated tree endpoint or return all categories with `parent_id`.

### 8.3 User Interests

Resource:

```txt
user/interests
```

Database table:

```txt
user_interests
```

Endpoints:

```txt
GET     /api/v1/user/interests
POST    /api/v1/user/interests
PATCH   /api/v1/user/interests/{user_id}
DELETE  /api/v1/user/interests/{user_id}
```

Allowed create fields:

```txt
user_id
interest_category_id
```

Create request:

```json
{
  "user_id": 1,
  "interest_category_id": 11
}
```

Important:

- This table has a composite primary key: `user_id + interest_category_id`.
- Current generic update/delete resolves by `user_id`, so be careful when deleting. A dedicated endpoint for composite IDs is recommended before production.

### 8.4 Weather Alerts

Resource:

```txt
weather
```

Database table:

```txt
weather_alerts
```

Endpoints:

```txt
GET     /api/v1/weather
POST    /api/v1/weather
GET     /api/v1/weather/{id}
PATCH   /api/v1/weather/{id}
DELETE  /api/v1/weather/{id}
```

Allowed fields:

```txt
district
upazila
alert_type
severity
title_en
title_bn
body_en
body_bn
weather_payload
source
starts_at
ends_at
send_push
is_active
```

Enum values:

```txt
alert_type: forecast, rain, wind, flood, heat, cold, maritime, field_advice, custom
severity: info, advisory, watch, warning, critical
source: weather_server, admin_local, hybrid
```

Example row:

```json
{
  "id": "1",
  "location": "Mymensingh / Mymensingh Sadar",
  "headline": "Warm today, humidity is high",
  "metrics": "heat - advisory",
  "advice": "Be careful drying crops and storing livestock feed.",
  "status": "advisory"
}
```

Mobile use:

- Show active alerts by district/upazila.
- Use `severity` for visual priority.
- Use `send_push=1` for push notification candidates.

### 8.5 Market Updates

Resource:

```txt
market-updates
```

Database table:

```txt
market_updates
```

Endpoints:

```txt
GET     /api/v1/market-updates
POST    /api/v1/market-updates
GET     /api/v1/market-updates/{id}
PATCH   /api/v1/market-updates/{id}
DELETE  /api/v1/market-updates/{id}
```

Allowed fields:

```txt
title_en
title_bn
body_en
body_bn
update_type
district
upazila
status
starts_at
ends_at
sort_order
```

Enum values:

```txt
update_type: price, stock, training, weather, project, notice
status: draft, active, expired
```

Example:

```json
{
  "title_en": "Cattle rate: 670/kg",
  "body_en": "Updated today. Eid demand high.",
  "update_type": "price",
  "district": "Mymensingh",
  "upazila": "Mymensingh Sadar",
  "status": "active"
}
```

## 9. Sale Listing APIs

### 9.1 Sale Categories

Resource:

```txt
sale/categories
```

Database table:

```txt
sale_categories
```

Allowed fields:

```txt
slug
name_en
name_bn
description_en
description_bn
is_active
sort_order
```

Mobile use:

- Use for "what do you want to sell?" category cards.
- Example categories from seed: crops, livestock, inputs, machinery.

### 9.2 Sale Items

Resource:

```txt
sale/items
```

Database table:

```txt
sale_items
```

Allowed fields:

```txt
sale_category_id
slug
name_en
name_bn
description_en
description_bn
status
metadata
```

Enum values:

```txt
status: active, soon, inactive
```

Sample item:

```json
{
  "sale_category_id": 2,
  "slug": "cattle",
  "name_en": "Cattle",
  "name_bn": "Cow",
  "status": "active",
  "metadata": {
    "unit": "kg",
    "requires_ai_photo": true
  }
}
```

### 9.3 Animal Breeds

Resource:

```txt
sale/breeds
```

Database table:

```txt
animal_breeds
```

Allowed fields:

```txt
animal_type
name_en
name_bn
is_active
```

Sample values:

```txt
cattle: Cross Friesian, Local, Sahiwal
goat: Black Bengal
poultry: Broiler
```

### 9.4 Sale Pricing Rules

Resource:

```txt
sale/pricing
```

Database table:

```txt
sale_pricing_rules
```

Allowed fields:

```txt
sale_item_id
district
effective_from
effective_to
b2b_market_rate
farmer_rate
platform_fee
logistics_fee
warehouse_vet_fee
unit
is_active
```

Example:

```json
{
  "sale_item_id": 1,
  "district": "Mymensingh",
  "effective_from": "2026-05-13",
  "b2b_market_rate": 750,
  "farmer_rate": 670,
  "platform_fee": 50,
  "logistics_fee": 15,
  "warehouse_vet_fee": 15,
  "unit": "kg",
  "is_active": 1
}
```

Mobile use:

- Calculate farmer expected income.
- Show transparent price breakdown.
- Filter by `sale_item_id`, district, and active date on the app side until filter query params are added server-side.

### 9.5 Sale Listings

Resource:

```txt
sale/listings
```

Database table:

```txt
sale_listings
```

Endpoints:

```txt
GET     /api/v1/sale/listings
POST    /api/v1/sale/listings
GET     /api/v1/sale/listings/{id}
PATCH   /api/v1/sale/listings/{id}
DELETE  /api/v1/sale/listings/{id}
```

Allowed create fields:

```txt
listing_code
user_id
sale_item_id
breed_id
title_en
title_bn
age_months
weight_kg
quantity
unit
farmer_expected_price
estimated_earning
contact_phone
address_text
ai_analysis_json
status
```

Allowed update fields:

```txt
sale_item_id
breed_id
title_en
title_bn
age_months
weight_kg
quantity
unit
farmer_expected_price
estimated_earning
contact_phone
address_text
ai_analysis_json
status
approved_by
approved_at
```

Enum values:

```txt
status: draft, submitted, field_verification, active, sold, rejected, cancelled
```

Create request example:

```json
{
  "listing_code": "SAL-APP-1001",
  "user_id": 1,
  "sale_item_id": 1,
  "breed_id": 1,
  "title_en": "Cross Friesian bull for sale",
  "title_bn": "Bull for sale",
  "age_months": 26,
  "weight_kg": 210,
  "quantity": 1,
  "unit": "piece",
  "farmer_expected_price": 670,
  "estimated_earning": 140700,
  "contact_phone": "01712-345678",
  "address_text": "Char Nilakkhmiya, Mymensingh Sadar",
  "ai_analysis_json": {
    "condition": "healthy",
    "confidence": 0.88,
    "field_verification": "pending"
  },
  "status": "submitted"
}
```

Detail response includes joined farmer/item/category/breed data:

```json
{
  "ok": true,
  "data": {
    "row": {
      "id": 1,
      "listing_code": "SAL-24018",
      "user_id": 1,
      "sale_item_id": 1,
      "breed_id": 1,
      "farmer_name": "Md. Rahim",
      "farmer_phone": "01712-345678",
      "item_name": "Cattle",
      "category_name": "Livestock",
      "breed_name": "Cross Friesian",
      "status": "field_verification"
    },
    "related": {
      "pricing_rules": []
    }
  }
}
```

Mobile flow:

1. Load `sale/categories`
2. Load `sale/items`
3. Load `sale/breeds` if livestock/cattle
4. Load `sale/pricing` for price estimate
5. POST `sale/listings`
6. Show status until admin/field officer updates listing to `active`, `sold`, etc.

## 10. Buy APIs

### 10.1 Buy Categories

Resource:

```txt
buy/categories
```

Database table:

```txt
buy_categories
```

Allowed fields:

```txt
slug
name_en
name_bn
description_en
description_bn
sort_order
is_active
```

Seed examples:

```txt
shadhin-feed
seeds
fertilizer
agri-medicine
tools
machinery-rental
```

### 10.2 Products

Resource:

```txt
buy/products
```

Database table:

```txt
products
```

Allowed fields:

```txt
buy_category_id
sku
name_en
name_bn
short_description_en
short_description_bn
unit
package_size
price
stock_qty
low_stock_threshold
delivery_window
status
metadata
```

Enum values:

```txt
status: draft, active, out_of_stock, inactive
```

Example product:

```json
{
  "buy_category_id": 1,
  "sku": "BUY-FEED-01",
  "name_en": "Shadhin Cattle Feed",
  "name_bn": "Shadhin Cattle Feed",
  "short_description_en": "High protein, supports weight gain, local delivery",
  "unit": "sack",
  "package_size": "50kg",
  "price": 1800,
  "stock_qty": 240,
  "low_stock_threshold": 20,
  "delivery_window": "2-3 days",
  "status": "active",
  "metadata": {
    "features": ["50 kg", "High protein", "Local delivery"]
  }
}
```

Mobile use:

- Only show `status=active` products.
- Mark `out_of_stock` products as unavailable.
- Use `stock_qty <= low_stock_threshold` for low stock badge.

### 10.3 Orders

Resource:

```txt
buy/orders
```

Database table:

```txt
orders
```

Allowed create fields:

```txt
order_code
user_id
total_amount
delivery_fee
payable_amount
payment_method
payment_status
fulfillment_status
delivery_address
district
upazila
notes
```

Allowed update fields:

```txt
total_amount
delivery_fee
payable_amount
payment_method
payment_status
fulfillment_status
delivery_address
district
upazila
notes
```

Enum values:

```txt
payment_method: cash, bkash, nagad, bank, credit, other
payment_status: pending, paid, failed, refunded
fulfillment_status: placed, confirmed, assigned, in_transit, delivered, cancelled
```

Field aliases accepted:

```txt
address -> delivery_address
payment -> payment_status
fulfillment -> fulfillment_status
```

Create order:

```json
{
  "order_code": "ORD-APP-1001",
  "user_id": 1,
  "total_amount": 9000,
  "delivery_fee": 0,
  "payable_amount": 9000,
  "payment_method": "bkash",
  "payment_status": "pending",
  "fulfillment_status": "placed",
  "delivery_address": "Char Nilakkhmiya, Mymensingh Sadar",
  "district": "Mymensingh",
  "upazila": "Mymensingh Sadar",
  "notes": "Deliver within 2-3 working days."
}
```

Detail response related data:

```json
{
  "data": {
    "row": {},
    "related": {
      "order_items": [
        {
          "id": 1,
          "order_id": 1,
          "product_id": 1,
          "quantity": 5,
          "unit_price": 1800,
          "line_total": 9000,
          "sku": "BUY-FEED-01",
          "product_name": "Shadhin Cattle Feed"
        }
      ]
    }
  }
}
```

### 10.4 Order Items

Resource:

```txt
orders/items
```

Database table:

```txt
order_items
```

Allowed fields:

```txt
order_id
product_id
quantity
unit_price
line_total
```

Create order item:

```json
{
  "order_id": 1,
  "product_id": 1,
  "quantity": 5,
  "unit_price": 1800,
  "line_total": 9000
}
```

Recommended mobile order sequence:

1. POST `/api/v1/buy/orders`
2. Read `result.insertId`
3. POST one or more `/api/v1/orders/items` rows with `order_id`

### 10.5 Payment Management

Resource:

```txt
orders/payments
```

This uses the same `orders` table but exposes payment-focused list/update behavior.

Allowed update fields:

```txt
payment_method
payment_status
notes
```

Example:

```json
{
  "payment_method": "bkash",
  "payment_status": "paid",
  "notes": "Payment verified from mobile transaction."
}
```

## 11. Learning APIs

### 11.1 Learning Categories

Resource:

```txt
learning/categories
```

Database table:

```txt
learning_categories
```

Allowed fields:

```txt
slug
name_en
name_bn
sort_order
is_active
```

Seed examples:

```txt
livestock
agriculture
climate
women
healthcare
```

### 11.2 Learning Modules

Resource:

```txt
learning/modules
```

Database table:

```txt
learning_modules
```

Allowed fields:

```txt
learning_category_id
title_en
title_bn
subtitle_en
subtitle_bn
thumbnail_asset_id
sort_order
status
```

Enum values:

```txt
status: draft, published, archived
```

Detail response related data:

```json
{
  "data": {
    "row": {},
    "related": {
      "contents": [
        {
          "id": 1,
          "learning_module_id": 1,
          "content_type": "article",
          "title_en": "Recognizing early disease signs",
          "status": "published"
        }
      ]
    }
  }
}
```

### 11.3 Learning Contents

Resource:

```txt
learning/contents
```

Database table:

```txt
learning_contents
```

Allowed fields:

```txt
learning_module_id
content_type
title_en
title_bn
body_en
body_bn
video_url
duration_seconds
quiz_json
sort_order
status
```

Enum values:

```txt
content_type: article, video, quiz
status: draft, published, archived
```

Example quiz:

```json
{
  "learning_module_id": 1,
  "content_type": "quiz",
  "title_en": "5-question health quiz",
  "quiz_json": {
    "pass_score": 60,
    "questions": [
      {
        "q": "How often should cattle be observed?",
        "answer": "Twice daily"
      }
    ]
  },
  "sort_order": 3,
  "status": "published"
}
```

### 11.4 User Learning Progress

Resource:

```txt
learning/progress
```

Database table:

```txt
user_learning_progress
```

Allowed fields:

```txt
user_id
learning_content_id
status
completed_at
score
```

Enum values:

```txt
status: not_started, in_progress, completed
```

Create/update progress:

```json
{
  "user_id": 1,
  "learning_content_id": 3,
  "status": "in_progress",
  "score": 40
}
```

Important:

- This table has composite identity: `user_id + learning_content_id`.
- Current generic update/delete resolves by `user_id`; a dedicated endpoint is recommended for exact progress-row updates.

## 12. Partner Project and KYC APIs

### 12.1 Partner Projects

Resource:

```txt
partners/projects
```

Database table:

```txt
partner_projects
```

Allowed fields:

```txt
project_code
name_en
name_bn
lender_name
district
upazila
start_date
end_date
capacity
max_credit_amount
status
steps_json
```

Enum values:

```txt
status: draft, open, opening_soon, closed, completed
```

Example:

```json
{
  "project_code": "PRJ-2024-EID",
  "name_en": "Cattle Fattening - Eid Batch 2024",
  "lender_name": "BRAC Bank",
  "district": "Mymensingh",
  "upazila": "Mymensingh Sadar",
  "start_date": "2024-03-01",
  "end_date": "2024-08-31",
  "capacity": 50,
  "max_credit_amount": 50000,
  "status": "open",
  "steps_json": ["Project selection", "Personal KYC", "Banking info", "Farm assessment"]
}
```

### 12.2 Partner Applications / KYC

Resource:

```txt
partners/applications
```

Database table:

```txt
partner_applications
```

Allowed create fields:

```txt
application_code
user_id
partner_project_id
current_step
full_name_per_nid
nid_number
total_land_decimals
livestock_count
primary_income_source
annual_household_income
mobile_banking_provider
banking_json
farm_assessment_json
verification_notes
status
assigned_officer_id
```

Allowed update fields:

```txt
current_step
full_name_per_nid
nid_number
total_land_decimals
livestock_count
primary_income_source
annual_household_income
mobile_banking_provider
banking_json
farm_assessment_json
verification_notes
status
assigned_officer_id
approved_by
approved_at
```

Enum values:

```txt
current_step: project_selection, personal_kyc, banking_info, farm_assessment, field_verification, approval, rejected
status: draft, submitted, needs_document, officer_verification, ready_to_approve, approved, rejected
```

Field aliases accepted:

```txt
notes -> verification_notes
officer -> assigned_officer_id
```

Create KYC/application:

```json
{
  "application_code": "KYC-APP-1001",
  "user_id": 1,
  "partner_project_id": 1,
  "current_step": "project_selection",
  "full_name_per_nid": "Md. Rahim",
  "nid_number": "19901234567890123",
  "total_land_decimals": 120,
  "livestock_count": 5,
  "primary_income_source": "Livestock",
  "annual_household_income": 120000,
  "mobile_banking_provider": "bKash",
  "banking_json": {
    "account_no": "01712-345678"
  },
  "farm_assessment_json": {
    "shed_condition": "good",
    "feed_storage": "available"
  },
  "verification_notes": "Submitted from mobile app.",
  "status": "submitted"
}
```

Detail response related data:

```json
{
  "data": {
    "row": {},
    "related": {
      "project_ledgers": []
    }
  }
}
```

### 12.3 Partner Ledger

Resource:

```txt
partners/ledgers
```

Database table:

```txt
project_ledgers
```

Allowed fields:

```txt
partner_application_id
entry_type
title_en
title_bn
amount
entry_date
metadata
```

Enum values:

```txt
entry_type: input, vet_care, payment, profit_share, settlement, adjustment
```

## 13. Community APIs

### 13.1 Community Posts

Resource:

```txt
community/posts
```

Database table:

```txt
community_posts
```

Allowed create fields:

```txt
user_id
scope
post_type
body
district
upazila
status
```

Allowed update fields:

```txt
scope
post_type
body
district
upazila
status
like_count
comment_count
report_count
moderated_by
moderated_at
```

Enum values:

```txt
scope: upazila, district, bangladesh
post_type: general, question, livestock, crop, complaint, notice
status: visible, answered, hidden, moderation, removed
```

Create post:

```json
{
  "user_id": 1,
  "scope": "upazila",
  "post_type": "livestock",
  "body": "My cattle reached 200kg, listed on Shathi Sheba.",
  "district": "Mymensingh",
  "upazila": "Mymensingh Sadar",
  "status": "visible"
}
```

Detail response related data:

```json
{
  "data": {
    "row": {},
    "related": {
      "comments": []
    }
  }
}
```

### 13.2 Community Comments

Resource:

```txt
community/comments
```

Database table:

```txt
community_comments
```

Allowed fields:

```txt
community_post_id
user_id
body
status
```

Enum values:

```txt
status: visible, hidden, removed
```

Create comment:

```json
{
  "community_post_id": 1,
  "user_id": 2,
  "body": "Congratulations. How many days did it take?",
  "status": "visible"
}
```

### 13.3 Community Reports

Resource:

```txt
community/reports
```

This uses the `community_posts` table but filters posts where:

```txt
report_count > 0 OR status IN ('moderation', 'hidden', 'removed')
```

Allowed update fields:

```txt
status
moderated_by
moderated_at
report_count
```

Field alias:

```txt
admin_id -> moderated_by
```

## 14. Notification APIs

### 14.1 Notification Campaigns

Resource:

```txt
notifications/campaigns
```

Database table:

```txt
notification_campaigns
```

Allowed fields:

```txt
title_en
title_bn
body_en
body_bn
target_json
campaign_type
status
scheduled_at
sent_at
created_by
```

Enum values:

```txt
campaign_type: weather, market, learning, order, project, community, custom
status: draft, scheduled, sent, cancelled
```

Example:

```json
{
  "title_en": "Rain possible after evening",
  "body_en": "Cover harvested crops and stored feed.",
  "target_json": {
    "district": "Mymensingh",
    "interest": "crops"
  },
  "campaign_type": "weather",
  "status": "scheduled",
  "scheduled_at": "2026-05-13T18:00:00Z",
  "created_by": 1
}
```

## 15. Media Assets

Resource:

```txt
media/assets
```

Database table:

```txt
media_assets
```

Allowed fields:

```txt
owner_type
owner_id
asset_type
title
alt_text
url
mime_type
size_bytes
metadata
uploaded_by
```

Enum values:

```txt
asset_type: image, video, document, icon, thumbnail
```

Mobile use:

- Category icons
- Product images
- Learning thumbnails
- Uploaded listing photos in future

## 16. Reports

### GET `/api/v1/reports`

Returns summary metrics for dashboards.

Example response:

```json
{
  "ok": true,
  "data": {
    "marketplace": {
      "sale_listings": 3,
      "buy_orders": 3
    },
    "approvals": {
      "partner_applications": 3
    },
    "content": {
      "learning_modules": 4
    },
    "community": {
      "posts": 3
    }
  }
}
```

## 17. Admin-Only Resources

The mobile app usually should not call these directly.

### Admin Users

Resource:

```txt
admin/users
```

Database table:

```txt
admin_users
```

Allowed fields:

```txt
name
email
phone
password_hash
role
district
upazila
is_active
last_login_at
```

### Audit Logs

Resource:

```txt
audit/logs
```

Database table:

```txt
audit_logs
```

Allowed fields:

```txt
actor_admin_id
action
entity_type
entity_id
before_json
after_json
ip_address
user_agent
```

## 18. Full Database Resource Catalog

The current backend exposes these database-backed resources:

```txt
admin/users
audit/logs
buy/categories
buy/orders
buy/products
community/comments
community/posts
community/reports
interests
learning/categories
learning/contents
learning/modules
learning/progress
market-updates
media/assets
notifications/campaigns
orders/items
orders/payments
partners/applications
partners/ledgers
partners/projects
sale/breeds
sale/categories
sale/items
sale/listings
sale/pricing
user/interests
users
weather
```

All database-backed resources support the same REST method pattern:

```txt
GET     /api/v1/{resource}
POST    /api/v1/{resource}
GET     /api/v1/{resource}/{id}
PATCH   /api/v1/{resource}/{id}
PUT     /api/v1/{resource}/{id}
DELETE  /api/v1/{resource}/{id}
```

## 19. Generic CRUD Examples

### List rows

```bash
curl http://localhost:3000/api/v1/buy/products
```

### Get one row

```bash
curl http://localhost:3000/api/v1/buy/products/1
```

### Create row

```bash
curl -X POST http://localhost:3000/api/v1/buy/products \
  -H "Content-Type: application/json" \
  -d '{
    "buy_category_id": 1,
    "sku": "BUY-FEED-APP-01",
    "name_en": "Shadhin Cattle Feed",
    "unit": "sack",
    "price": 1800,
    "stock_qty": 240,
    "status": "active"
  }'
```

### Patch row

```bash
curl -X PATCH http://localhost:3000/api/v1/buy/products/1 \
  -H "Content-Type: application/json" \
  -d '{
    "stock_qty": 220,
    "status": "active"
  }'
```

### Delete row

```bash
curl -X DELETE http://localhost:3000/api/v1/buy/products/1
```

## 20. JSON Fields

The API accepts object payloads for JSON columns. The backend stringifies object values before saving.

Examples:

```json
{
  "profile_json": {
    "primary_work": "livestock",
    "language": "bn"
  }
}
```

```json
{
  "ai_analysis_json": {
    "condition": "healthy",
    "confidence": 0.88
  }
}
```

```json
{
  "metadata": {
    "features": ["50 kg", "High protein"]
  }
}
```

## 21. Known Current Limitations

These are important for the mobile app agent:

1. Authentication is not implemented yet.
2. Pagination is not implemented yet.
3. Search/filter query params are limited. Some routes read query params in seed fallback code, but database list queries currently return full lists.
4. Composite-key resources use generic ID handling and should get dedicated endpoints before production:
   - `user/interests`
   - `learning/progress`
5. File upload is not implemented. Use `media/assets.url` for existing or externally uploaded media.
6. `sale/listings` create requires `listing_code`; the backend defaults one if missing, but mobile should still generate a unique code if possible.
7. Order creation and order item creation are separate calls. There is not yet a single transaction endpoint for cart checkout.
8. Some list endpoints return admin-friendly joined/summary rows. Detail endpoints return raw row data and related records.

## 22. Recommended Mobile App Integration Order

Build the mobile app against endpoints in this order:

1. `GET /api/v1/catalog`
2. `GET /api/v1/interests`
3. `POST /api/v1/users`
4. `PATCH /api/v1/users/{id}`
5. `POST /api/v1/user/interests`
6. `GET /api/v1/weather`
7. `GET /api/v1/market-updates`
8. `GET /api/v1/sale/categories`
9. `GET /api/v1/sale/items`
10. `GET /api/v1/sale/breeds`
11. `GET /api/v1/sale/pricing`
12. `POST /api/v1/sale/listings`
13. `GET /api/v1/buy/categories`
14. `GET /api/v1/buy/products`
15. `POST /api/v1/buy/orders`
16. `POST /api/v1/orders/items`
17. `GET /api/v1/learning/categories`
18. `GET /api/v1/learning/modules`
19. `GET /api/v1/learning/contents`
20. `POST /api/v1/learning/progress`
21. `GET /api/v1/partners/projects`
22. `POST /api/v1/partners/applications`
23. `GET /api/v1/community/posts`
24. `POST /api/v1/community/posts`
25. `POST /api/v1/community/comments`

## 23. Suggested Mobile Data Models

### AppUser

```ts
type AppUser = {
  id: number;
  full_name: string;
  display_name?: string | null;
  phone: string;
  email?: string | null;
  gender?: "male" | "female" | "other" | "undisclosed" | null;
  date_of_birth?: string | null;
  district?: string | null;
  upazila?: string | null;
  union_name?: string | null;
  village?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  status: "active" | "suspended" | "pending";
  profile_json?: Record<string, unknown> | null;
};
```

### SaleListing

```ts
type SaleListing = {
  id: number;
  listing_code: string;
  user_id: number;
  sale_item_id: number;
  breed_id?: number | null;
  title_en?: string | null;
  title_bn?: string | null;
  age_months?: number | null;
  weight_kg?: number | null;
  quantity: number;
  unit: string;
  farmer_expected_price?: number | null;
  estimated_earning?: number | null;
  contact_phone?: string | null;
  address_text?: string | null;
  ai_analysis_json?: Record<string, unknown> | null;
  status: "draft" | "submitted" | "field_verification" | "active" | "sold" | "rejected" | "cancelled";
};
```

### Product

```ts
type Product = {
  id: number;
  buy_category_id: number;
  sku: string;
  name_en: string;
  name_bn?: string | null;
  short_description_en?: string | null;
  short_description_bn?: string | null;
  unit: string;
  package_size?: string | null;
  price: number;
  stock_qty: number;
  low_stock_threshold: number;
  delivery_window?: string | null;
  status: "draft" | "active" | "out_of_stock" | "inactive";
  metadata?: Record<string, unknown> | null;
};
```

### Order

```ts
type Order = {
  id: number;
  order_code: string;
  user_id: number;
  total_amount: number;
  delivery_fee: number;
  payable_amount: number;
  payment_method: "cash" | "bkash" | "nagad" | "bank" | "credit" | "other";
  payment_status: "pending" | "paid" | "failed" | "refunded";
  fulfillment_status: "placed" | "confirmed" | "assigned" | "in_transit" | "delivered" | "cancelled";
  delivery_address: string;
  district?: string | null;
  upazila?: string | null;
  notes?: string | null;
};
```

### PartnerApplication

```ts
type PartnerApplication = {
  id: number;
  application_code: string;
  user_id: number;
  partner_project_id: number;
  current_step: "project_selection" | "personal_kyc" | "banking_info" | "farm_assessment" | "field_verification" | "approval" | "rejected";
  full_name_per_nid?: string | null;
  nid_number?: string | null;
  total_land_decimals?: number | null;
  livestock_count?: number | null;
  primary_income_source?: string | null;
  annual_household_income?: number | null;
  mobile_banking_provider?: string | null;
  banking_json?: Record<string, unknown> | null;
  farm_assessment_json?: Record<string, unknown> | null;
  verification_notes?: string | null;
  status: "draft" | "submitted" | "needs_document" | "officer_verification" | "ready_to_approve" | "approved" | "rejected";
};
```

## 24. Implementation Notes for the Mobile App AI Agent

- Always check `ok === true` before reading `data`.
- Treat list and detail responses differently.
- For detail pages, read `data.row`.
- For related children, read `data.related`.
- For create responses, read `result.insertId`.
- For update/delete responses, read `result.affectedRows`.
- Store generated IDs locally after creation.
- Use server IDs, not display codes, for updates/deletes.
- Use `status` fields for user-facing workflow states.
- Use Bangla fields (`*_bn`) when the app language is Bangla.
- Use English fields (`*_en`) as fallback if Bangla values are missing.

## 25. Production Hardening Checklist

Before public app release:

- Add authentication.
- Add pagination: `page`, `page_size`.
- Add filters: `district`, `upazila`, `status`, `user_id`, `category_id`.
- Add upload endpoint for listing images and profile photos.
- Add transaction endpoint for order + order items.
- Add dedicated composite-key endpoints for user interests and learning progress.
- Add validation for required fields and enum values.
- Add API rate limits.
- Add consistent lowercase `status` aliases in all MySQL detail responses.
- Add API docs route or OpenAPI export.

