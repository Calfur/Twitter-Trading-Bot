const TwitterApi = require('twitter-api-v2');

const config = require('./config.js');
const ftxInterface = require('./ftxInterface.js')

let twitterStream = {};
let tweetTime = null;

const twitterClient = new TwitterApi.TwitterApi(config.twitterAPI.bearer_token).readOnly;

initialize();

process.on('unhandledRejection', (reason, p) => {
   console.log('ERROR 110', reason);
});

async function initialize() {
   const users = await getUsers();

   if (users.length == 0) {
      console.error("No user found. Please configure valid twitter user names.");
   }

   startStream(users);
}

function getUsers() {
   return new Promise((resolve, reject) => {
      const userDatas = [];

      config.twitterUserNames.forEach(async (userName, i) => {
         await new Promise(r => setTimeout(r, i * 500));
         const user = await getUser(userName);

         userDatas.push(user.data);
         if (userDatas.length === config.twitterUserNames.length) {
            resolve(user.data)
         };
      });
   });
}

async function getUser(username) {
   return new Promise((resolve, reject) => {
      user = twitterClient.v2.userByUsername(username);
      resolve(user);
   });
}

async function startStream(users) {
   if (twitterStream.destroy) {
      twitterStream.destroy() // close old stream
      console.log("Old stream destroyed");
   };

   await new Promise(r => setTimeout(r, 2000));

   twitterStream = await twitterClient.v2.searchStream({
      "tweet.fields": [
         "text",
         "created_at"
      ]
   });

   await deleteAllExistingRules();
   await addRulesToTwitterStream(users);

   addEventHandlers(twitterStream);
   enableAutoReconnect(twitterStream);

   console.log('Twitter API Stream Started');
}

async function addRulesToTwitterStream(users) {
   var addedRules = await twitterClient.v2.updateStreamRules({
      add: [
         { value: `(from:${users.name})`, tag: `Tweets from ${users.name}` },
      ],
   });

   console.log(`Sumary of rule creation: ${addedRules.meta.sumary}`);
   console.log(addedRules.data);

   return addedRules;
}

function enableAutoReconnect(twitterStream) {
   twitterStream.autoReconnect = true;
}

function addEventHandlers(twitterStream) {
   twitterStream.on(
      // Emitted when a Twitter payload (a tweet or not, given the endpoint).
      TwitterApi.ETwitterStreamEvent.Data,
      eventData => processTweet(eventData)
   );

   twitterStream.on(
      // Emitted when Node.js {response} emits a 'error' event (contains its payload).
      TwitterApi.ETwitterStreamEvent.ConnectionError,
      err => console.log('Connection error!', err)
   );

   twitterStream.on(
      // Emitted when Node.js {response} is closed by remote or using .close().
      TwitterApi.ETwitterStreamEvent.ConnectionClosed,
      () => console.log('Connection has been closed. Starting Stream again.')
   );
}

async function deleteAllExistingRules() {
   console.log("Deleting existing rules...");

   var streamRules = await twitterClient.v2.streamRules();

   if (streamRules.data == null) {
      console.log("No rules found to delete.");
      return;
   }

   idsToDelete = streamRules.data.map(streamRule => streamRule.id);

   var deletedRules = await twitterClient.v2.updateStreamRules({
      delete: {
         ids: idsToDelete,
      },
   });

   console.log("Deleted rules:");
   console.log(deletedRules);
}

function processTweet(eventData) {
   tweetTime = eventData.data.created_at;
   log('Twitter has sent something:', eventData);
   var tweetText = eventData.data.text;
   log('Text:', tweetText);

   var cpi = extractCpi(tweetText);
   var coreCpi = extractCoreCpi(tweetText);
   log({ cpi, coreCpi });

   if (isNumeric(cpi) && isNumeric(coreCpi)) {
      if (cpi <= 7.9 && cpi >= 5 && coreCpi <= 6.3 && coreCpi >= 4) {
         openLongPosition();
      } else if (cpi >= 8.3 && cpi <= 15 && coreCpi >= 6.6 && coreCpi <= 13) {
         openShortPosition();
      } else {
         log("Might not be worth a trade :/");
      }
   } else {
      log("These are no valid numbers :/");
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
   log(`Try to buy ${config.currencyTradeAmount} ${config.currency}`);
   ftxInterface.ftxOrder(config.currency, config.currencyTradeAmount, 'buy')
}

function openShortPosition() {
   log(`Try to sell ${config.currencyTradeAmount} ${config.currency}`);
   ftxInterface.ftxOrder(config.currency, config.currencyTradeAmount, 'sell')
}

function log(text) {
   var timeSinceTweet = getTimeSinceTweet();
   var logStamp = timeSinceTweet != null ? `Tweet+${timeSinceTweet}: ` : ``;
   console.log(`${logStamp}${text}`);
}

function getTimeSinceTweet() {
   if (tweetTime == null) {
      return null;
   }

   return Date.now() - tweetTime;
}
