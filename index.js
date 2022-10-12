const TwitterApi = require('twitter-api-v2');
const request = require('request');
const crypto = require('crypto');

const config = require('./config.js');

const markets = {};
let twitterStream = {};

const twitterClient = new TwitterApi.TwitterApi(config.twitterAPI.bearer_token).readOnly;

/*
{
   appKey: config.twitterAPI.consumer_key,
   appSecret: config.twitterAPI.consumer_secret,
   accessToken: config.twitterAPI.access_token_key,
   accessSecret: config.twitterAPI.access_token_secret,
}
*/

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

   if(streamRules.data == null){
      console.log("No rules found to delete :)");
   } else{
      idsToDelete = streamRules.data.map(streamRule => streamRule.id);
   
      console.log({idsToDelete});
   
      var deletedRules = await twitterClient.v2.updateStreamRules({
         delete: {
            ids: idsToDelete,
         },
      });
   
      console.log({deletedRules});
   }
}

const startStream = async (followerIDs) => {
   console.log("startStream");

   const filter = { filter_level: 'none', from: followerIDs.join(',') };

   if (twitterStream.destroy) {
      twitterStream.destroy() // close old stream
   };

   await new Promise(r => setTimeout(r, 2000));

   twitterStream = await twitterClient.v2.getStream("tweets/search/stream/rules");

   await deleteAllExistingRules();

   var addedRules = await twitterClient.v2.updateStreamRules({
      add: [
         { value: '(from:Calfur_Test)', tag: 'Tweets from @Calfur_test' },
      ],
   });
   
   var streamRules = await twitterClient.v2.streamRules();

   // Log every rule ID
   console.log(streamRules);
   
   /*

   twitterStream.on('data', (tweet) => {
      //console.log(tweet);
      let tweetText = tweet.text;
      if (tweet.extended_tweet && tweet.extended_tweet.full_text) {
         tweetText = tweet.extended_tweet.full_text;
      }
      tweetText = tweetText.toLowerCase();
      if (!followerIDs.includes(tweet.user.id_str)) return false;
      console.log(`[${tweet.user.screen_name}] ${tweetText} (${new Date().getTime()})`);
      config.keywords.forEach((kw) => {
         const keyword = kw.toLowerCase();
         if (tweetText.includes(keyword)) {
            executeTrade(keyword);
         }
      });
   });

   twitterStream.on('error', (error) => {
      console.log(error);
   });

   twitterStream.on('disconnect', (error) => {
      console.log('Stream Disconnected...');
      startStream();
   });

   twitterStream.on('reconnect', (request, response, connectInterval) => {
      console.log('Waiting to reconnect in ' + connectInterval + 'ms');
      setTimeout(() => {
         startStream();
      }, connectInterval + 100);
   });

   console.log('Twitter API Stream Started');

   setTimeout(() => {
      twitterStream.destroy();
      startStream(followerIDs);
   }, 3600000); // reset stream
   
   */
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

const ftxOrder = (market, quantity) => {
   const ts = new Date().getTime();
   const query = {
      market: market,
      side: 'buy',
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
   //ftxOrder(market, quantity);
   const trailingStop = round((config.trailingStopPercentage * -0.01) * price);
   console.log(`Setting trailing stop ${market} ${quantity} ${trailingStop}  (${new Date().getTime()})`);
   //ftxTrailingStop(market, quantity, trailingStop);
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
