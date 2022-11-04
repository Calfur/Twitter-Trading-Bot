const TwitterApi = require('twitter-api-v2');
const FtxInterface = require('./ftxInterface.js') 
const config = require('./config.js');

const twitterClient = new TwitterApi.TwitterApi(config.twitterAPI.bearer_token).readOnly;
const ftxInterface = new FtxInterface();

let twitterStream = {};
let tweetTime = null;

initialize();

process.on('unhandledRejection', (reason, p) => {
   console.log('ERROR 110', reason);
});

async function initialize() {
   log("Getting users from twitter API...");
   const users = await getUsers();
   
   if (users.length == 0) {
      console.error("No user found. Please configure valid twitter user names.");
   }

   log(`${users.length} users found`);
   console.log(users);

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
            resolve(userDatas)
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
      log("Deleting old stream connection...");
      twitterStream.destroy() // close old stream
   };

   await new Promise(r => setTimeout(r, 2000));

   await deleteAllExistingRules();
   await addRulesToTwitterStream(users);

   log('Starting Twitter API Stream...');

   twitterStream = await twitterClient.v2.searchStream({
      "tweet.fields": [
         "text",
         "created_at"
      ]
   });

   addEventHandlers(twitterStream);
   enableAutoReconnect(twitterStream);

   log('Twitter API Stream Started...');
}

async function addRulesToTwitterStream(users) {
   log("Creating rules...");

   var rules = [];
   users.forEach(user => rules.push(
      { value: `(from:${user.id})`, tag: `Tweets from ${user.name}` }
   ));

   var addedRules = await twitterClient.v2.updateStreamRules({
      add: rules,
   });

   log("Sumary of rule creation: ");
   console.log(addedRules.meta.summary);
   log("Added rules: ");
   addedRules.data.forEach(addedRule => console.log(addedRule));

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
   console.log(deletedRules.meta);
}

function processTweet(eventData) {
   tweetTime = new Date(eventData.data.created_at);
   log('Processing Tweet...');
   var tweetText = eventData.data.text;
   log(`Text: ${tweetText}`);

   try{
      /*
      var cpi = extractCpi(tweetText);
      var coreCpi = extractCoreCpi(tweetText);
      log(`CPI: ${cpi} CORE CPI: ${coreCpi}`);

      if (isNumeric(cpi) && isNumeric(coreCpi)) {
         if (cpi <= 7.9 && cpi >= 5 && coreCpi <= 6.3 && coreCpi >= 4) {
            openLongPosition();
         } else if (cpi >= 8.3 && cpi <= 15 && coreCpi >= 6.6 && coreCpi <= 13) {
            openShortPosition();
         } else {
            log("Might not be worth a trade :/");
         }
      }
      else {
         log("These are no valid numbers :/");
      }
      */

      var nonfarmPayrolls = extractNonfarmPayrolls(tweetText);
      log(`Nonfarm Payrolls: ${nonfarmPayrolls}`);

      if(isNumeric(nonfarmPayrolls)){
         if(nonfarmPayrolls < 160000){
            openLongPosition();
         }else if(nonfarmPayrolls > 260000){
            openShortPosition();
         }else{
            log("Might not be worth a trade :/");
         }
      }
      else {
         log("This is no valid number :/");
      }
   }
   catch (exception){
      console.log(exception);
   }    
}

function isNumeric(str) {
   if (typeof str != "string") return false
   return !isNaN(str) && !isNaN(parseFloat(str))
}

function extractCpi(text) {
   var cpi = /(?<=U.S. CPI: \+)(.{1,5})(?=% YEAR-OVER-YEAR)/.exec(text);
   if(cpi){
      cpi = cpi[0];
   }
   return cpi;
}

function extractCoreCpi(text) {
   var coreCpi = /(?<=U.S. CORE CPI: \+)(.{1,5})(?=% YEAR-OVER-YEAR)/.exec(text);
   if(coreCpi){
      coreCpi = coreCpi[0];
   }
   return coreCpi;
}

function extractNonfarmPayrolls(text) {
   var nonfarmPayrolls = /(?<=U.S. NONFARM PAYROLLS: \+)(.{1,8})(?= \(EST\.)/.exec(text);
   if(nonfarmPayrolls){
      nonfarmPayrolls = nonfarmPayrolls[0];
   }
   return nonfarmPayrolls;
}

async function openLongPosition() {
   openPosition('buy');
}

async function openShortPosition() {
   openPosition('sell');
}

async function openPosition(direction){
   log(`Try to ${direction} ${config.currencyTradeAmount} ${config.currency}`);
   var message = await ftxInterface.ftxOrder(config.currency, config.currencyTradeAmount, direction);
   log(message);
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
