const TwitterApi = require('twitter-api-v2');
const request = require('request');
const crypto = require('crypto');

const config = require('./config.js');

const markets = {};
let twitterStream = {};

const twitterClient = new TwitterApi.TwitterApi(config.twitterAPI.bearer_token).readOnly;

const round = (num, decimals = 8, down = false) => {
   if (typeof num !== 'number') num = parseFloat(num);
   const multiplier = 10 ** decimals;
   let roundedNumber = Math.round(num * multiplier) / multiplier;
   if (down) roundedNumber = Math.floor(num * multiplier) / multiplier;
   return Number(roundedNumber);
}

const getUser = async (username) => {
   return new Promise((resolve, reject) => {
      user = twitterClient.v2.userByUsername(username);
      resolve(user);
   });
}

const sortFollowerIDs = () => {
   return new Promise((resolve, reject) => {
      const followerIDs = [];
      config.follows.forEach(async (screenname, i) => {
         await new Promise(r => setTimeout(r, i * 500));
         const user = await getUser(screenname);
         const userId = user.data.id;
         console.log(`TwitterID: ${screenname} ${userId}`);
         followerIDs.push(userId);
         if (followerIDs.length === config.follows.length) resolve(followerIDs);
      });
   });
}

const deleteAllExistingRules = async () => {
   var streamRules = await twitterClient.v2.streamRules();

   if (streamRules.data == null) {
      console.log("No rules found to delete :)");
   } else {
      idsToDelete = streamRules.data.map(streamRule => streamRule.id);

      console.log(idsToDelete);

      var deletedRules = await twitterClient.v2.updateStreamRules({
         delete: {
            ids: idsToDelete,
         },
      });

      console.log(deletedRules.meta);
   }
}

const startStream = async (followerIDs) => {
   console.log("startStream");

   const filter = { filter_level: 'none', from: followerIDs.join(',') };

   if (twitterStream.destroy) {
      twitterStream.destroy() // close old stream
   };

   await new Promise(r => setTimeout(r, 2000));

   twitterStream = await twitterClient.v2.searchStream({
      "tweet.fields": [
         "text"
      ],
      "expansions": [
         "author_id"
      ]
   });

   await deleteAllExistingRules();

   var addedRules = await twitterClient.v2.updateStreamRules({
      add: [
         { value: '(from:Calfur_Test)', tag: 'Tweets from @Calfur_test' },
      ],
   });

   await logCurrentStreamRules();

   twitterStream.on(
      // Emitted when a Twitter payload (a tweet or not, given the endpoint).
      TwitterApi.ETwitterStreamEvent.Data,
      eventData => processTweet(eventData),
   );

   console.log(TwitterApi.ETwitterStreamEvent.Data);

   twitterStream.on(
      // Emitted when Node.js {response} emits a 'error' event (contains its payload).
      TwitterApi.ETwitterStreamEvent.ConnectionError,
      err => console.log('Connection error!', err),
   );

   twitterStream.on(
      // Emitted when Node.js {response} is closed by remote or using .close().
      TwitterApi.ETwitterStreamEvent.ConnectionClosed,
      () => console.log('Connection has been closed. Starting Stream again.'),
   );

   // Enable reconnect feature
   twitterStream.autoReconnect = true;

   console.log('Twitter API Stream Started');
}

const sortMarkets = async () => {
   request('https://ftx.com/api/markets', (err, res, ticket) => {
      if (err) console.log(err);
      if (ticket) {
         const ticketObject = JSON.parse(ticket);
         ticketObject.result.forEach((market) => {
            if (!market.name.includes('-PERP')) return false;
            markets[market.name] = market.price; // USD
         });
      } else {
         console.log(ticket);
      }
   });
}

const ftxOrder = (market, quantity, side) => {
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

const ftxTrailingStop = (market, quantity, stop) => {
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

const executeTrade = (keyword) => {
   const market = config.market;
   if (!markets[market]) return false;
   const price = markets[market];
   const quantity = round(config.usdValue / price);
   console.log(`Executing trade ${market} ${quantity} (${new Date().getTime()})`);
   ftxOrder(market, quantity);
   const trailingStop = round((config.trailingStopPercentage * -0.01) * price);
   console.log(`Setting trailing stop ${market} ${quantity} ${trailingStop}  (${new Date().getTime()})`);
   ftxTrailingStop(market, quantity, trailingStop);
}

const init = async () => {
   const followerIDs = await sortFollowerIDs();
   await sortMarkets();
   startStream(followerIDs);
   setInterval(() => {
      sortMarkets();
   }, 300000); // 5 min updates
}

init();

process.on('unhandledRejection', (reason, p) => {
   console.log('ERROR 110', reason);
});

function processTweet(eventData) {
   console.log('Twitter has sent something:', eventData);
   var text = eventData.data.text;
   console.log('Text:', text);

   var cpi = extractCpi(text);
   var coreCpi = extractCoreCpi(text);
   console.log({ cpi, coreCpi });

   if (isNumeric(cpi) && isNumeric(coreCpi)) {
      if (cpi <= 7.9 && cpi >= 5 && coreCpi <= 6.3 && coreCpi >= 4 ) {
         openLongPosition();
      } else if (cpi >= 8.3 && cpi <= 15 && coreCpi >= 6.6 && coreCpi <= 13) {
         openShortPosition();
      } else {
         console.log("Might not be worth a trade :/");
      }
   } else {
      console.log("These are no valid numbers :/");
   }
}

function isNumeric(str) {
   if (typeof str != "string") return false
   return !isNaN(str) && !isNaN(parseFloat(str))
}

function extractCpi(text) {
   var cpi = /(?<=U.S. CPI: \+)(.{1,5})(?=% YEAR-OVER-YEAR)/.exec(text)[0];
   return cpi;
}

function extractCoreCpi(text) {
   var coreCpi = /(?<=U.S. CORE CPI: \+)(.{1,5})(?=% YEAR-OVER-YEAR)/.exec(text)[0];
   return coreCpi;
}

function openLongPosition() {
   ftxOrder(config.market, config.marketValue, 'buy')
   console.log("LONG!");
}

function openShortPosition() {
   ftxOrder(config.market, config.marketValue, 'sell')
   console.log("SHORT!");
}

async function logCurrentStreamRules() {
   var streamRules = await twitterClient.v2.streamRules();
   console.log({ "streamRules": streamRules.meta });
}
