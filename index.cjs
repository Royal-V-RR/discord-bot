'use strict';

const { OWNER_IDS } = require('./config');

const echoCommandHandler = (interaction) => {
    const messageId = interaction.options.getString('replyto').split('/').pop(); // Extract just the message ID

    // Other code for /echo command
};

const gamesendCommandHandler = (interaction) => {
    if (!OWNER_IDS.includes(interaction.user.id)) {
        return interaction.reply('You do not have permissions to use this command.');
    }

    // Code to end all running games instantly
    // ...
};

module.exports = {
    echo: echoCommandHandler,
    gamesend: gamesendCommandHandler,
};
