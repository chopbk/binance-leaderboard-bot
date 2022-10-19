const Tgfancy = require("tgfancy");
const listText = require("../utils/list-text");
const keyboard = require("../utils/keyboard");
const { getUserInfo, createMember } = require("../database/model");
const {
  buildPositionsMsg,
  buildStaticPositionMsg,
  buildPerformanceInfoMsg,
} = require("../leaderboard/leaderboard-services");
const logger = require("../utils/logger");
const delay = require("../utils/time");
const getDefaultOptions = () => {
  return {
    disable_web_page_preview: true,
    parse_mode: "Markdown",
    allow_sending_without_reply: true,
    reply_markup: {
      resize_keyboard: true,
      force_reply: false,
    },
  };
};
class TeleBot {
  constructor() {}
  init = async (eventEmitter) => {
    this.bot = new Tgfancy(process.env.TOKEN, {
      polling: true,
      tgfancy: {
        // options for this fanciness
        ratelimiting: {
          maxRetries: 10, // default: 10
          timeout: 1000 * 60, // default: 60000 (1 minute)
          maxBackoff: 1000 * 60 * 5, // default: 5 minutes
        },
      },
    });
    let me = await this.bot.getMe();
    logger.debug(`getMe ${JSON.stringify(me)}`);
    this.botUsername = me.username;
    this.botFirstName = me.first_name || "";
    this.botLastName = me.last_name || "";

    return this;
  };
  run = () => {
    this.bot.onText(/\/start/, this.handleStart);
    this.bot.on("callback_query", this.handleCallBackQuerry);
    this.bot.on("polling_error", (error) => logger.error(error.message));
    this.bot.on("message", async (msg) => {
      try {
        if (!msg.text) return;
        let messageText = msg.text.toUpperCase();
        if (!messageText) return;
        if (messageText.startsWith("/")) {
          let args = messageText.replace(/\//g, "").split(" ");
          let commandParameter = args[0].split("?").join(" ").split(" ");
          const params = Object.fromEntries(
            new URLSearchParams(
              commandParameter[1] ? commandParameter[1].toLowerCase() : ""
            )
          );

          params.data = args[1] ? args[1].replace(/\n/g, "") : "";
          logger.debug(params);
          switch (commandParameter[0]) {
            case "P":
            case "POS":
            case "POSITION":
              this.handleGetPositions(msg, params);
              break;
            case "S":
            case "STATIC":
              this.handleGetStaticPosition(msg, params);
              break;
            case "I":
            case "INFO":
              this.handleGetInfo(msg, params);
              break;
            case "T":
            case "TOP":
              this.handleGetTopLeader(msg, params);
              break;
          }
          return;
        }
        // send a message to the chat acknowledging receipt of their message
        return;
      } catch (error) {
        logger.error(`On telegram message + ${error}`);
      }
    });
    // maybe get more speed
    this.bot.on("channel_post", async (msg) => {
      let messageText = msg.text || msg.caption;
      if (!messageText) return;
      const chatId = msg.chat.id.toString();
      if (messageText.startsWith("/")) {
        return;
      }
    });
  };
  handleStart = async (msg) => {
    if (!msg.from.username) {
      await this.bot.sendMessage(
        msg.chat.id,
        `⚠️ Your telegram username not found. \nPlease go to  User Settings to set this then start again`
      );
      return;
    }
    let res = await this.checkUserInfo(msg);
    if (!res) return;
    // build message for airdrop
    logger.debug(`[checkUserInfo] button`);
    await this.bot.sendMessage(msg.chat.id, listText.welcome);
    // await this.isUserDone(res, msg);
  };

  checkUserInfo = async (msg) => {
    try {
      if (msg.from.is_bot) {
        return false;
      }
      let ref = msg.text.replace("/start", "").trim();
      if (isNaN(ref)) ref = null;
      // find account exist on Database
      let account = await getUserInfo(msg.from.id);
      if (!account)
        account = await createMember({
          ...msg.from,
          ref: ref,
          captcha: "",
        });

      return account;
    } catch (error) {
      logger.error(`[checkUserInfo] ${error.message}`);
    }
  };
  sendMessage(message, id) {
    let options = getDefaultOptions();
    this.bot.sendMessage(id, message, options);
    return;
  }
  sendReplyCommand(message, msg) {
    let options = getDefaultOptions();
    if (msg.message_id) options.reply_to_message_id = msg.message_id;

    if (msg.reply_markup && !msg.channel) {
      options.reply_markup = Object.assign(
        options.reply_markup,
        msg.reply_markup
      );
    }
    this.bot
      .sendMessage(msg.chat.id, message, options)
      .catch((error) => console.log(error));
    return;
  }
  handleCallBackQuerry = async (callbackQuery) => {
    try {
      const { id, message, data, from } = callbackQuery;
      logger.debug(
        `[callbackQuery]: id ${id} data ${data} message ${JSON.stringify(
          message
        )}`
      );
      logger.debug(`[callbackQuery]: from ${JSON.stringify(from)}`);
      let queryData = data.split("_");
      let callbackData = {
        chatId: message.chat.id,
        messageId: message.message_id,
        id: id,
      };
      switch (queryData[0]) {
        case "POSITION": {
          let uid = queryData[1];
          await this.handleGetPositionsCallback(callbackData, uid);
          break;
        }
        case "STATIC": {
          let uid = queryData[1];
          await this.handleGetStaticPositionCallback(callbackData, uid);
          break;
        }
        case "STATIC": {
          let uid = queryData[1];
          await this.handleGetInfoCallback(callbackData, uid);
          break;
        }
      }
    } catch (error) {
      logger.error(`[handleCallBackQuerry] ${error.message}`);
    }
  };
  handleGetPositions = async (msg, params) => {
    if (!params.data) {
      this.bot.sendMessage(msg.chat.id, listText.helpPosition);
    }
    let uids = params.data.replace(/#/g, "").split(",");
    for (const uid of uids) {
      if (uid.length !== 32) {
        this.bot.sendMessage(msg.chat.id, listText.uidNotValid(uid));
        return;
      }
      let text = await buildPositionsMsg(uid);
      msg.reply_markup = keyboard.refreshPosition(uid);
      logger.debug(msg.reply_markup);
      this.sendReplyCommand(text, msg);
      // await this.isUserDone(res, msg);
    }
  };
  handleGetPositionsCallback = async (callbackData, uid) => {
    let text = await buildPositionsMsg(uid);
    let options = getDefaultOptions();
    options.chat_id = callbackData.chatId;
    options.message_id = callbackData.messageId;
    options.reply_markup = Object.assign(
      options.reply_markup,
      keyboard.refreshPosition(uid)
    );
    await this.bot.editMessageText(text, options);
    this.bot.answerCallbackQuery(callbackData.id, {
      text: "Refresh Position Done",
    });
  };

  handleGetStaticPosition = async (msg, params) => {
    if (!params.data) {
      this.bot.sendMessage(msg.chat.id, listText.helpPosition);
    }

    let uids = params.data.replace(/#/g, "").split(",");
    for (const uid of uids) {
      if (uid.length !== 32) {
        this.bot.sendMessage(msg.chat.id, listText.uidNotValid(uid));
        return;
      }
      let text = await buildStaticPositionMsg(uid, params.detail);
      msg.reply_markup = keyboard.refreshHistoryPosition(uid);
      this.sendReplyCommand(text, msg);
      await delay(500);
    }

    // await this.isUserDone(res, msg);
  };
  handleGetStaticPositionCallback = async (callbackData, uid) => {
    let text = await buildStaticPositionMsg(uid);
    let options = getDefaultOptions();
    options.chat_id = callbackData.chatId;
    options.message_id = callbackData.messageId;
    options.reply_markup = Object.assign(
      options.reply_markup,
      keyboard.refreshHistoryPosition(uid)
    );
    await this.bot.editMessageText(text, options);
    this.bot.answerCallbackQuery(callbackData.id, {
      text: "Refresh Static Done",
    });
  };

  handleGetInfo = async (msg, params) => {
    if (!params.data) {
      this.bot.sendMessage(msg.chat.id, listText.helpPosition);
    }
    let uids = params.data.replace(/#/g, "").split(",");
    for (const uid of uids) {
      if (uid.length !== 32) {
        this.bot.sendMessage(msg.chat.id, listText.uidNotValid(uid));
        return;
      }
      let text = await buildPerformanceInfoMsg(uid, params.detail);
      if (params.S)
        text +=
          `\n----------------------------\n` +
          (await buildStaticPositionMsg(uid));
      if (params.P)
        text +=
          `\n----------------------------\n` + (await buildPositionsMsg(uid));
      if (params.A) {
        text +=
          `\n----------------------------\n` +
          (await buildStaticPositionMsg(uid));
        text +=
          `\n----------------------------\n` + (await buildPositionsMsg(uid));
      }
      msg.reply_markup = keyboard.refreshPerformanceInfo(uid);
      this.sendReplyCommand(text, msg);
      await delay(500);
    }

    // await this.isUserDone(res, msg);
  };
  handleGetInfoCallback = async (callbackData, uid) => {
    let text = await buildPerformanceInfoMsg(uid);
    let options = getDefaultOptions();
    options.chat_id = callbackData.chatId;
    options.message_id = callbackData.messageId;
    options.reply_markup = Object.assign(
      options.reply_markup,
      keyboard.refreshPerformanceInfo(uid)
    );
    await this.bot.editMessageText(text, options);
    this.bot.answerCallbackQuery(callbackData.id, {
      text: "Refresh Static Done",
    });
  };
}

module.exports = new TeleBot();
