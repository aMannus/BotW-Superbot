//Modules
const Discord = require('discord.js');
const jsonfile = require('jsonfile');
const fs = require('fs');

//Global
const configFile = './config.json';
const config = jsonfile.readFileSync(configFile);

//Twitch Init
const twitch = require('./twitch-helix');

const discordToken = config["discord-token"];
const activeGuild = config["discord-server-id"];
const streamNotificationChannel = config["discord-notifications-channel-id"];

//State Init
const stateFile = './state.json';
let state = {
  "activeStreams": {}
};
if (!fs.existsSync(stateFile)) {
  jsonfile.writeFileSync(stateFile, state);
} else {
  state = jsonfile.readFileSync(stateFile);
}

//Discord Init
let botIsReady = false;
const botIntents = [
  Discord.GatewayIntentBits.Guilds,
  Discord.GatewayIntentBits.GuildMembers,
  Discord.GatewayIntentBits.GuildPresences,
  Discord.GatewayIntentBits.GuildMessages,
  Discord.GatewayIntentBits.GuildMessageReactions,
  Discord.GatewayIntentBits.DirectMessages,
  Discord.GatewayIntentBits.MessageContent
];

const botPartials = ['MESSAGE', 'CHANNEL', 'REACTION'];

const bot = new Discord.Client({ intents: botIntents, partials: botPartials, restTimeOffset: 200 });

bot.on('ready', () => {
  botIsReady = true;
  console.log('Logged in as %s - %s\n', bot.user.username, bot.user.id);
});

async function streamNotificationManagement(message) {
  if (message.member != undefined) {
    if (message.member.permissions.has("ManageMessages")) {
      if (message.content.toLowerCase() === "!clear") {
        _clearChat(message.channel.id,true);
        return;
      }
    }
  }
}

//Automatic Stream Announcement
twitch.on('messageStreamStarted', (stream) => {
  console.log(stream.url +' is live on Twitch playing ' + stream.game + ': ' + stream.title);
  if (stream.id in state.activeStreams)
    return;

  let channel = bot.guilds.cache.get(activeGuild).channels.cache.get(streamNotificationChannel);

  if (channel) {
    var postDate = JSON.parse(JSON.stringify(new Date()));
    let title = escapeDiscordSpecials(stream.title);
    title = title.replace("_", "\\_");
    const embed = {
      "title": escapeDiscordSpecials(title),
      "description": "",
      "url": stream.url,
      "color": 1369976,
      "timestamp": postDate,
      "footer": {
        //"icon_url": config["bot-avatar-url"],
        "text": "Playing a HM64 Port"
      },
      "thumbnail": {
        "url": stream.user_profile_image
      },
      "author": {
        "name": escapeDiscordSpecials(stream.name) + " is now live on Twitch!",
        "url": stream.url,
        "icon_url": config["bot-avatar-url"]
      }
    };

    channel.send({embeds: [embed]})
    .catch((e) => {
      console.error(e);
    })
    .then(sentMessage => {
      let stateElem =  { 
        "stream_url": stream.url,
        "stream_title": stream.title,
        "user": stream.name,
        "messageID": sentMessage.id
      };
      state.activeStreams[stream.id] = stateElem;

      commitState();
    });
  
  }
});

//Automatic Stream Cleanup
twitch.on('messageStreamDeleted', (stream) => {
  //console.log (stream.url + " went offline");

  if (!(stream.id in state.activeStreams))
    return;

  delete state.activeStreams[stream.id];
  commitState();

  let channel = bot.guilds.cache.get(activeGuild).channels.cache.get(streamNotificationChannel);
  /*channel.messages.fetch({ limit: 80 })
     .then(messages => {
       messages.forEach(message => */
  channel.messages.fetch({
      limit: 80
    }, true, true)
    .then(messages => {
      messages.each(msgObj => {
        if (!msgObj)
          return;
        if ((msgObj.embeds) && (msgObj.embeds.length > 0)) {
          if (msgObj.embeds[0].url == stream.url) {
            msgObj.delete();
          }
        }
      })
    })
    .catch((e) => {
      console.error(e);
    });
});

//Message Handler
bot.on('messageCreate', message => {
  if (message.channel.id == streamNotificationChannel)
    streamNotificationManagement(message);
});

async function _clearChat(textChannelID, wipeStreams = false) {

  let channel = bot.channels.cache.get(textChannelID);

  if (!channel)
    return;

  let messages = await wipeChannelAndReturnMessages(channel);

  console.log("Channel Clearing: Removed", messages.size, "messages in channel", channel.name);
  if (wipeStreams) {
    state.activeStreams = {};
    commitState();
  }
}

async function wipeChannelAndReturnMessages(textChannel) {
  console.log("clearing all messages from " + textChannel.id);

  let deletedMessages = await textChannel.bulkDelete(99, true);

  let msgPool = deletedMessages;

  while (deletedMessages.size > 0) {
    deletedMessages = await textChannel.bulkDelete(99, true);
    if (deletedMessages.size > 0)
      msgPool = msgPool.concat(deletedMessages); 
  }

  return msgPool;
}

//Cleanup
function checkForOutdatedStreams() {
  for (stream in state.activeStreams) {
    let streamObj = state.activeStreams[stream];
     //if streamObj has not been updated in 12 hours (for example, in event of a bot crash)
    if ((streamObj.lastUpdate + 12*60*60) < new Date().getTime()) {
      bot.guilds.cache.get(activeGuild).channels.cache.get(streamNotificationChannel).fetch(state.activeStream[stream].messageID)
      .then(fetchedMsg => {
        fetchedMsg.delete()
        .then(() => console.log(`Deleted abandoned stream message for stream ${state.activeStreams[stream]["display_name"]}`))
        .catch(console.error);
      })
      
      delete state.activeStream[stream]
      commitState();
    }
  }
}

//Sys
function commitState() {
  jsonfile.writeFile(stateFile, state, { spaces: 2 }, function (err) {
    if (err) console.error(err)
  });
}

function escapeDiscordSpecials(inputString) {
  return inputString.replace(/_/g, "\_").replace(/\*/g, "\\*").replace(/~/g, "\~");
}


//Init
bot.login(discordToken)
.catch(err => {
  console.error(err);
});


bot.on('error', () => {
  console.error("The bot encountered a connection error!!");

  setTimeout(() => {

    bot.login(discordToken);
  }, 10000);
});

bot.on('disconnect', () => {
  console.error("The bot disconnected!!");

  botIsReady = false;

  setTimeout(() => {
    bot.login(discordToken);
  }, 10000);
});

setInterval(() => {
  checkForOutdatedStreams();
}, 300000);
