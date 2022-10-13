const request = require('request');
const crypto = require('crypto');

function ftxOrder(market, quantity, side) {
   const ts = new Date().getTime();
   const query = {
      market: market,
      side: side,
      size: quantity,
      type: 'market',
      price: 0,
   }
   const queryString = `${ts}POST/api/orders${JSON.stringify(query)}`;
   const signature = crypto.createHmac('sha256', config.ftxAPI.apiSecret).update(queryString).digest('hex');
   const uri = `https://ftx.com/api/orders`;
   const headers = {
      "FTX-KEY": config.ftxAPI.apiKey,
      "FTX-TS": String(ts),
      "FTX-SIGN": signature,
      "FTX-SUBACCOUNT": config.ftxAPI.subAccount
   };
   request({ headers, uri, method: 'POST', body: query, json: true }, function (err, res, ticket) {
      if (err) console.log(err);
      if (ticket && ticket.result && ticket.result.id) {
         console.log(`Order confirmed: ${ticket.result.id}`);
      } else {
         console.log(ticket);
      }
   });
}

/*
function ftxTrailingStop(market, quantity, stop) {
   const ts = new Date().getTime();
   const query = {
      market: market,
      side: 'sell',
      trailValue: stop,
      size: quantity,
      type: 'trailingStop',
      reduceOnly: true,
   }
   const queryString = `${ts}POST/api/conditional_orders${JSON.stringify(query)}`;
   const signature = crypto.createHmac('sha256', config.ftxAPI.apiSecret).update(queryString).digest('hex');
   const uri = `https://ftx.com/api/conditional_orders`;
   const headers = {
      "FTX-KEY": config.ftxAPI.apiKey,
      "FTX-TS": String(ts),
      "FTX-SIGN": signature,
      "FTX-SUBACCOUNT": config.ftxAPI.subAccount
   };
   request({ headers, uri, method: 'POST', body: query, json: true }, function (err, res, ticket) {
      if (err) console.log(err);
      if (ticket && ticket.result && ticket.result.id) {
         console.log(`Trailing Stop Loss Set: ${ticket.result.id}`);
      } else {
         console.log(ticket);
      }
   });
}
*/