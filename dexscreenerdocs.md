Reference
DEX Screener API reference

Get the latest token profiles (rate-limit 60 requests per minute)
GEThttps://api.dexscreener.com/token-profiles/latest/v1
Response

200
Ok

Body

application/json
urlstring (uri)
chainIdstring
tokenAddressstring
iconstring (uri)
headernullable string (uri)
descriptionnullable string
linksnullable array of object

Request

JavaScript
Copy
const response = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
    method: 'GET',
    headers: {},
});
const data = await response.json();
Test it
Response

200
Copy
{
  "url": "https://example.com",
  "chainId": "text",
  "tokenAddress": "text",
  "icon": "https://example.com",
  "header": "https://example.com",
  "description": "text",
  "links": [
    {
      "type": "text",
      "label": "text",
      "url": "https://example.com"
    }
  ]
}
Get the latest boosted tokens (rate-limit 60 requests per minute)
GEThttps://api.dexscreener.com/token-boosts/latest/v1
Response

200
Ok

Body

application/json
urlstring (uri)
chainIdstring
tokenAddressstring
amountnumber
totalAmountnumber
iconnullable string (uri)
headernullable string (uri)
descriptionnullable string
linksnullable array of object

Request

JavaScript
Copy
const response = await fetch('https://api.dexscreener.com/token-boosts/latest/v1', {
    method: 'GET',
    headers: {},
});
const data = await response.json();
Test it
Response

200
Copy
{
  "url": "https://example.com",
  "chainId": "text",
  "tokenAddress": "text",
  "amount": 0,
  "totalAmount": 0,
  "icon": "https://example.com",
  "header": "https://example.com",
  "description": "text",
  "links": [
    {
      "type": "text",
      "label": "text",
      "url": "https://example.com"
    }
  ]
}
Get the tokens with most active boosts (rate-limit 60 requests per minute)
GEThttps://api.dexscreener.com/token-boosts/top/v1
Response

200
Ok

Body

application/json
urlstring (uri)
chainIdstring
tokenAddressstring
amountnumber
totalAmountnumber
iconnullable string (uri)
headernullable string (uri)
descriptionnullable string
linksnullable array of object

Request

JavaScript
Copy
const response = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
    method: 'GET',
    headers: {},
});
const data = await response.json();
Test it
Response

200
Copy
{
  "url": "https://example.com",
  "chainId": "text",
  "tokenAddress": "text",
  "amount": 0,
  "totalAmount": 0,
  "icon": "https://example.com",
  "header": "https://example.com",
  "description": "text",
  "links": [
    {
      "type": "text",
      "label": "text",
      "url": "https://example.com"
    }
  ]
}
Check orders paid for of token (rate-limit 60 requests per minute)
GEThttps://api.dexscreener.com/orders/v1/{chainId}/{tokenAddress}
Path parameters

chainIdstring
Example: "solana"
tokenAddressstring
Example: "A55XjvzRU4KtR3Lrys8PpLZQvPojPqvnv5bJVHMYy3Jv"
Response

200
Ok

Body

application/json
typeenum
tokenProfile
communityTakeover
tokenAd
trendingBarAd
statusenum
processing
cancelled
on-hold
approved
rejected
paymentTimestampnumber
Request

JavaScript
Copy
const response = await fetch('https://api.dexscreener.com/orders/v1/{chainId}/{tokenAddress}', {
    method: 'GET',
    headers: {},
});
const data = await response.json();
Test it
Response

200
Copy
[
  {
    "type": "tokenProfile",
    "status": "processing",
    "paymentTimestamp": 0
  }
]
Get one or multiple pairs by chain and pair address (rate-limit 300 requests per minute)
GEThttps://api.dexscreener.com/latest/dex/pairs/{chainId}/{pairId}
Path parameters

chainIdstring
Example: "solana"
pairIdstring
Example: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"
Response

200
Ok

Body

application/json
schemaVersionstring
pairsnullable array of Pair (object)

Request

JavaScript
Copy
const response = await fetch('https://api.dexscreener.com/latest/dex/pairs/{chainId}/{pairId}', {
    method: 'GET',
    headers: {},
});
const data = await response.json();
Test it
Response

200
Copy
{
  "schemaVersion": "text",
  "pairs": [
    {
      "chainId": "text",
      "dexId": "text",
      "url": "https://example.com",
      "pairAddress": "text",
      "labels": [
        "text"
      ],
      "baseToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "quoteToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "priceNative": "text",
      "priceUsd": "text",
      "liquidity": {
        "usd": 0,
        "base": 0,
        "quote": 0
      },
      "fdv": 0,
      "marketCap": 0,
      "pairCreatedAt": 0,
      "info": {
        "imageUrl": "https://example.com",
        "websites": [
          {
            "url": "https://example.com"
          }
        ],
        "socials": [
          {
            "platform": "text",
            "handle": "text"
          }
        ]
      },
      "boosts": {
        "active": 0
      }
    }
  ]
}
Get one or multiple pairs by token address (rate-limit 300 requests per minute)
GEThttps://api.dexscreener.com/latest/dex/tokens/{tokenAddresses}
Path parameters

tokenAddressesstring
One or multiple, comma-separated token addresses (up to 30 addresses)

Example: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN,7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr"
Response

200
Ok

Body

application/json
schemaVersionstring
pairsnullable array of Pair (object)

Request

JavaScript
Copy
const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/{tokenAddresses}', {
    method: 'GET',
    headers: {},
});
const data = await response.json();
Test it
Response

200
Copy
{
  "schemaVersion": "text",
  "pairs": [
    {
      "chainId": "text",
      "dexId": "text",
      "url": "https://example.com",
      "pairAddress": "text",
      "labels": [
        "text"
      ],
      "baseToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "quoteToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "priceNative": "text",
      "priceUsd": "text",
      "liquidity": {
        "usd": 0,
        "base": 0,
        "quote": 0
      },
      "fdv": 0,
      "marketCap": 0,
      "pairCreatedAt": 0,
      "info": {
        "imageUrl": "https://example.com",
        "websites": [
          {
            "url": "https://example.com"
          }
        ],
        "socials": [
          {
            "platform": "text",
            "handle": "text"
          }
        ]
      },
      "boosts": {
        "active": 0
      }
    }
  ]
}
Search for pairs matching query (rate-limit 300 requests per minute)
GEThttps://api.dexscreener.com/latest/dex/search
Query parameters

Response

200
Ok

Body

application/json
schemaVersionstring
pairsarray of Pair (object)

Request

JavaScript
Copy
const response = await fetch('https://api.dexscreener.com/latest/dex/search?q=text', {
    method: 'GET',
    headers: {},
});
const data = await response.json();
Test it
Response

200
Copy
{
  "schemaVersion": "text",
  "pairs": [
    {
      "chainId": "text",
      "dexId": "text",
      "url": "https://example.com",
      "pairAddress": "text",
      "labels": [
        "text"
      ],
      "baseToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "quoteToken": {
        "address": "text",
        "name": "text",
        "symbol": "text"
      },
      "priceNative": "text",
      "priceUsd": "text",
      "liquidity": {
        "usd": 0,
        "base": 0,
        "quote": 0
      },
      "fdv": 0,
      "marketCap": 0,
      "pairCreatedAt": 0,
      "info": {
        "imageUrl": "https://example.com",
        "websites": [
          {
            "url": "https://example.com"
          }
        ],
        "socials": [
          {
            "platform": "text",
            "handle": "text"
          }
        ]
      },
      "boosts": {
        "active": 0
      }
    }
  ]
}
