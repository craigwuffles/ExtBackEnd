/**
 *    Copyright 2018 Amazon.com, Inc. or its affiliates
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

//creating a voting dictionary
var voteDict = {
  a: 0,
  b: 0,
  c: 0,
  d: 0,
  e: 0,
  f: 0,
  g: 0,
  pole: 0,
  winner: 0,
  timeLeft: 0,
};


//creating timer mechanism
const resetTimeLength = 15000; //in milliseconds
const countdownInterval = 250;
var timerStart = false;
var timeLeft = 0;



//I didnt make these values below
const fs = require('fs');
const Hapi = require('hapi');
const path = require('path');
const Boom = require('boom');
const color = require('color');
const ext = require('commander');
const jwt = require('jsonwebtoken');
const request = require('request');

// The developer rig uses self-signed certificates.  Node doesn't accept them
// by default.  Do not use this in production.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Use verbose logging during development.  Set this to false for production.
const verboseLogging = true;
const verboseLog = verboseLogging ? console.log.bind(console) : () => { };

//port updating for the hapi server
const PORT = process.env.PORT || 8081;


// Service state variables
const initialColor = color('#6441A4');      // super important; bleedPurple, etc.
const serverTokenDurationSec = 30;          // our tokens for pubsub expire after 30 seconds
const userCooldownMs = 1000;                // maximum input rate per user to prevent bot abuse
const userCooldownClearIntervalMs = 60000;  // interval to reset our tracking object
const channelCooldownMs = 1000;             // maximum broadcast rate per channel
const bearerPrefix = 'Bearer ';             // HTTP authorization headers have this prefix
const colorWheelRotation = 30;
const channelColors = {};
const channelCooldowns = {};                // rate limit compliance
let userCooldowns = {};                     // spam prevention

function missingOnline(name, variable) {
  const option = name.charAt(0);
  return `Extension ${name} required in online mode.\nUse argument "-${option} <${name}>" or environment variable "${variable}".`;
}

const STRINGS = {
  secretEnv: 'Using environment variable for secret',
  clientIdEnv: 'Using environment variable for client-id',
  ownerIdEnv: 'Using environment variable for owner-id',
  secretLocal: 'Using local mode secret',
  clientIdLocal: 'Using local mode client-id',
  ownerIdLocal: 'Using local mode owner-id',
  serverStarted: 'Server running at %s',
  secretMissing: missingOnline('secret', 'EXT_SECRET'),
  clientIdMissing: missingOnline('client ID', 'EXT_CLIENT_ID'),
  ownerIdMissing: missingOnline('owner ID', 'EXT_OWNER_ID'),
  messageSendError: 'Error sending message to channel %s: %s',
  pubsubResponse: 'Message to c:%s returned %s',
  cyclingColor: 'Cycling color for c:%s on behalf of u:%s',
  colorBroadcast: 'Broadcasting color %s for c:%s',
  sendColor: 'Sending Time %s to c:%s',
  cooldown: 'Please wait before clicking again',
  invalidAuthHeader: 'Invalid authorization header',
  invalidJwt: 'Invalid JWT',
};

var EXT_OWNER_ID = 222147546;
var ENV_OWNER_ID = 222147546;

ext.
//Jackson commented this out
  //version(require('../package.json').version).
  option('-s, --secret <secret>', 'Extension secret').
  option('-c, --client-id <client_id>', 'Extension client ID').
  option('-o, --owner-id 222147546', 'Extension owner ID').
  option('-l, --is-local', 'Developer rig local mode').
  parse(process.argv);

const ownerId = '222147546';
const secret = Buffer.from('qUH1nVSRo2/QOqSJu+ucyygITprlp5UEShkVrGfotzk=', 'base64');
let clientId;
if (ext.isLocal && ext.args.length) {
  const localFileLocation = path.resolve(ext.args[0]);
  clientId = require(localFileLocation).id;
}
clientId = 'rwpiubxipzoyo3h3hxzwmgl5m44kg7';
// Get options from the command line, environment, or, if local mode is
// enabled, the local value.
function getOption(optionName, environmentName, localValue) {
  const option = (() => {
    if (ext[optionName]) {
      return ext[optionName];
    } else if (process.env[environmentName]) {
      console.log(STRINGS[optionName + 'Env']);
      return process.env[environmentName];
    } else if (ext.isLocal && localValue) {
      console.log(STRINGS[optionName + 'Local']);
      return localValue;
    }
    console.log(STRINGS[optionName + 'Missing']);
    process.exit(1);
  })();
  console.log(`Using "${option}" for ${optionName}`);
  return option;
}

const server = new Hapi.Server({
  host: '0.0.0.0',
  port: PORT,
  //tls: {
    // If you need a certificate, execute "npm run cert".
  //  key: fs.readFileSync(path.resolve(__dirname, 'conf', 'server.key')),
 //   cert: fs.readFileSync(path.resolve(__dirname, 'conf', 'server.crt')),
 // },
  routes: {
    cors: {
      origin: ['*'],
    },
  },
});

// Verify the header and the enclosed JWT.
function verifyAndDecode(header) {
  if (header.startsWith(bearerPrefix)) {
    try {
      const token = header.substring(bearerPrefix.length);
      return jwt.verify(token, secret, { algorithms: ['HS256'] });
    }
    catch (ex) {
      throw Boom.unauthorized(STRINGS.invalidJwt);
    }
  }
  throw Boom.unauthorized(STRINGS.invalidAuthHeader);
}
/*
function colorCycleHandler(req) {
  console.log("color cycle handler running")
  // Verify all requests.
  const payload = verifyAndDecode(req.headers.authorization);
  const { channel_id: channelId, opaque_user_id: opaqueUserId } = payload;

  // Store the color for the channel.
  let currentColor = channelColors[channelId] || initialColor;

  // Bot abuse prevention:  don't allow a user to spam the button.
  if (userIsInCooldown(opaqueUserId)) {
    throw Boom.tooManyRequests(STRINGS.cooldown);
  }

  // Rotate the color as if on a color wheel.
  verboseLog(STRINGS.cyclingColor, channelId, opaqueUserId);
  currentColor = color(currentColor).rotate(colorWheelRotation).hex();

  // Save the new color for the channel.
  channelColors[channelId] = currentColor;

  // Broadcast the color change to all other extension instances on this channel.
  attemptColorBroadcast(channelId);

  return currentColor;
}
*/
function testvoteHandler(req) {
  console.log("Hello");
  return "helloD";
}
//VOTE COUNTER gather request converts it to vote and lgos it
function voteHandler(req) {
  //console.log("vote Handler is running")
  //console.log(req.payload)
//Convert request package to have color-id and cleans up the request
  payload = JSON.stringify(req.payload)
  color_id = payload.replace(/[{}:"]/g, "")
  //console.log(color_id)

  votes = voteDict[color_id]

  votes = votes + 1

  voteDict[color_id] = votes

  console.log("vote for: " + color_id + ", " + voteDict[color_id])

  //runs the first reset timer on an interval
  if (timerStart == false){
    timerStart = true;
    setInterval(countdownTimer, countdownInterval);
    }
  return timeLeft;

}



//makes a ledgiable countdowntimer
function countdownTimer(){
  timeLeft = timeLeft - countdownInterval;
  voteDict["timeLeft"] = timeLeft;
  //console.log("counting down: " + timeLeft)
  if(timeLeft <= 0){
    declareWinner();
    resetVote();
    timeLeft = resetTimeLength;}
}
//talley ighest vote and declares a winner with a pole number
function declareWinner(){
    highestVote = 0;
    numOfWinners = 0;
    winner = {};
  //Makes array of winner ofwinners as well as loggint the highest vote and number of winners
    if(highestVote == voteDict["a"]){ numOfWinners += 1; winner[numOfWinners] = "a"};
    if(highestVote < voteDict["a"]){ winner[1] = "a"; numOfWinners = 1; highestVote = voteDict["a"]};

    if(highestVote == voteDict["b"]){ numOfWinners += 1; winner[numOfWinners] = "b"};
    if(highestVote < voteDict["b"]){ winner[1] = "b"; numOfWinners = 1; highestVote = voteDict["b"]};

    if(highestVote == voteDict["c"]){ numOfWinners += 1; winner[numOfWinners] = "c"};
    if(highestVote < voteDict["c"]){ winner[1] = "c"; numOfWinners = 1; highestVote = voteDict["c"]};

    if(highestVote == voteDict["d"]){ numOfWinners += 1; winner[numOfWinners] = "d"};
    if(highestVote < voteDict["d"]){ winner[1] = "d"; numOfWinners = 1; highestVote = voteDict["d"]};

    if(highestVote == voteDict["e"]){ numOfWinners += 1; winner[numOfWinners] = "e"};
    if(highestVote < voteDict["e"]){ winner[1] = "e"; numOfWinners = 1; highestVote = voteDict["e"]};

    if(highestVote == voteDict["f"]){ numOfWinners += 1; winner[numOfWinners] = "f"};
    if(highestVote < voteDict["f"]){ winner[1] = "f"; numOfWinners = 1; highestVote = voteDict["f"]};

    if(highestVote == voteDict["g"]){ numOfWinners += 1; winner[numOfWinners] = "g"};
    if(highestVote < voteDict["g"]){ winner[1] = "g"; numOfWinners = 1; highestVote = voteDict["g"]};

    // if highest vote is 0 no one voted dont run
    if(highestVote == 0){
      console.log("No one voted");
    }
    // if there were votes
    if(highestVote > 0){
        //if there was not a tie declare the winner and increase the pole number
        if(numOfWinners == 1){
        voteDict["winner"] = winner[1]; voteDict["pole"] += 1;
        console.log("winner: " + voteDict["winner"] + " PoleNum: " + voteDict["pole"]);
        }

        // if there is a tie choose a random number from the tie and make that one the winner
        if(numOfWinners > 1){
        randWinner = Math.floor(Math.random() * numOfWinners + 1);
        console.log(randWinner);
        voteDict["winner"] = winner[randWinner]; voteDict["pole"]+= 1;
        console.log("random winner: " + voteDict["winner"] + " PoleNum: " + voteDict["pole"])
        }
   
    }
   
}
//Vote Timer that resets votes and sets next time to reset votes
function resetVote(){
  //Resets the ballots to 0
voteDict["a"]=0 ;
voteDict["b"]=0 ;
voteDict["c"]=0 ; 
voteDict["d"]=0 ; 
voteDict["e"]=0 ; 
voteDict["f"]=0 ; 
voteDict["g"]=0 ; 
  console.log("resseting votes");
}

/*
function colorQueryHandler(req) {
  // Verify all requests.
  const payload = verifyAndDecode(req.headers.authorization);

  // Get the color for the channel from the payload and return it.
  const { channel_id: channelId, opaque_user_id: opaqueUserId } = payload;
  const currentColor = color(channelColors[channelId] || initialColor).hex();
  verboseLog(STRINGS.sendColor, currentColor, opaqueUserId);
  return currentColor;
}
*/

function voteResetHandler(req) {
  console.log("Voter resethandler running")
  // Verify all requests.
  const payload = verifyAndDecode(req.headers.authorization);

  // Get the color for the channel from the payload and return it.
  const { channel_id: channelId, opaque_user_id: opaqueUserId } = payload;
  verboseLog(STRINGS.sendColor, timeLeft, opaqueUserId);
  return timeLeft;
}


function attemptColorBroadcast(channelId) {
  // Check the cool-down to determine if it's okay to send now.
  const now = Date.now();
  const cooldown = channelCooldowns[channelId];
  if (!cooldown || cooldown.time < now) {
    // It is.
    sendColorBroadcast(channelId);
    channelCooldowns[channelId] = { time: now + channelCooldownMs };
  } else if (!cooldown.trigger) {
    // It isn't; schedule a delayed broadcast if we haven't already done so.
    cooldown.trigger = setTimeout(sendColorBroadcast, now - cooldown.time, channelId);
  }
}

function sendColorBroadcast(channelId) {
  console.log("runnning send colorbroadcast")
  // Set the HTTP headers required by the Twitch API.
  const headers = {
    'Client-ID': clientId,
    'Content-Type': 'application/json',
    'Authorization': bearerPrefix + makeServerToken(channelId),
  };

  // Create the POST body for the Twitch API request.
  //const currentColor = color(channelColors[channelId] || initialColor).hex();
  const body = JSON.stringify({
    content_type: 'application/json',
    message: timeLeft,
    targets: ['broadcast'],
  });

  // Send the broadcast request to the Twitch API.
  verboseLog(STRINGS.colorBroadcast, timeLeft, channelId);
  const apiHost = ext.isLocal ? 'localhost.rig.twitch.tv:3000' : 'api.twitch.tv';
  request(
    `https://${apiHost}/extensions/message/${channelId}`,
    {
      method: 'POST',
      headers,
      body,
    }
    , (err, res) => {
      if (err) {
        console.log(STRINGS.messageSendError, channelId, err);
      } else {
        verboseLog(STRINGS.pubsubResponse, channelId, res.statusCode);
      }
    });
}

// Create and return a JWT for use by this service.
function makeServerToken(channelId) {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + serverTokenDurationSec,
    channel_id: channelId,
    user_id: ownerId, // extension owner ID for the call to Twitch PubSub
    role: 'external',
    pubsub_perms: {
      send: ['*'],
    },
  };
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

function userIsInCooldown(opaqueUserId) {
  // Check if the user is in cool-down.
  const cooldown = userCooldowns[opaqueUserId];
  const now = Date.now();
  if (cooldown && cooldown > now) {
    return true;
  }

  // Voting extensions must also track per-user votes to prevent skew.
  userCooldowns[opaqueUserId] = now + userCooldownMs;
  return false;
}

//here is the post reciever?
(async () => {

  // Start the server.
  await server.start();
  console.log(STRINGS.serverStarted, server.info.uri);

  // Handle a viewer request to cycle the color.
  server.route({
    method: 'POST',
    path: '/color/vote',
    handler: testvoteHandler,
  });

  // Handle a new viewer requesting the color.
  server.route({
    method: 'GET',
    path: '/color/query',
    handler: voteResetHandler,
  });

  // Start the server.
 // await server.start();
  //console.log(STRINGS.serverStarted, server.info.uri);

  // Periodically clear cool-down tracking to prevent unbounded growth due to
  // per-session logged-out user tokens.
  setInterval(() => { userCooldowns = {}; }, userCooldownClearIntervalMs);
})();

