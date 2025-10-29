const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');
const { Interaction } = require('../utils/database.js');
const { generateMongoFilter, callFlowise, genAI } = require('../utils/ai_helper.js');

/**
 * 검색된 기억(interaction document)의 내용을 보기 좋게 축약하는 함수
 * @param {object} doc - MongoDB에서 가져온 Interaction document
 * @returns {string} - 100자로 축약된 내용 문자열
 */
function formatMemoryContent(doc) {
    if (typeof doc.content === 'string') {
        return doc.content.length > 100 ? doc.content.substring(0, 100) + '...' : doc.content;
    }
    const summary = doc.content.rem || '내용 없음';
    return `[${doc.type}] ${summary}`.substring(0, 100);
}

/**
 * 검색된 기억을 바탕으로 임베드를 만들어 응답하는 함수
 * @param {import('discord.js').CommandInteraction} interaction - Discord 인터랙션 객체
 * @param {Array<object>} searchResults - MongoDB에서 검색된 결과 배열
 */
async function handleMemoryFound(interaction, searchResults) {
    const userQuestion = interaction.options.getString('question');
    const sessionId = interaction.user.id;
    
    const commentPrompt = `사용자가 "${userQuestion}" 라고 질문해서 관련 기억을 찾았어. 이 상황에 대해 짧고 자연스러운 코멘트를 해줘.`;
    const aiComment = await callFlowise(commentPrompt, sessionId, 'memory-comment');

    const embed = new EmbedBuilder()
        .setTitle('혹시 이 기억들을 찾고 있었어? 🤔')
        .setColor(0xFFD700);

    const description = searchResults.map((doc, index) => {
        const content = formatMemoryContent(doc);
        const messageLink = `https://discord.com/channels/${interaction.guildId}/${doc.channelId}/${doc.interactionId}`;
        const timestamp = new Date(doc.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        return `**${index + 1}.** [메시지 바로가기](${messageLink}) "${content}"\n*(${timestamp})*`;
    }).join('\n\n');
    
    embed.setDescription(description);

    if (aiComment) {
        embed.addFields({ name: "AI의 코멘트", value: aiComment });
    }

    await interaction.editReply({ content: `<@${sessionId}>`, embeds: [embed] });
}

/**
 * 일반적인 AI 대화를 처리하고 응답하는 함수
 * (기록이 있을 때만 history를 전송하고, Flowise 실패 시 Gemini로 폴백)
 * @param {import('discord.js').CommandInteraction} interaction - Discord 인터랙션 객체
 */
async function handleRegularConversation(interaction) {
    const userQuestion = interaction.options.getString('question');
    const sessionId = interaction.user.id;
    const attachment = interaction.options.getAttachment('file');
    const botName = interaction.client.user.username;

    let aiResponseText;

    try {
        const recentInteractions = await Interaction.find({ 
            userId: sessionId, 
            type: { $in: ['MESSAGE', 'MENTION'] } 
        }).sort({ timestamp: -1 }).limit(10);
        
        const history = recentInteractions.reverse().flatMap(doc => {
            const userMessage = typeof doc.content === 'string' ? doc.content : JSON.stringify(doc.content);
            const userTurn = { role: 'user', content: userMessage };
            if (doc.type === 'MENTION' && doc.botResponse) {
                return [userTurn, { role: 'assistant', content: doc.botResponse }];
            }
            return userTurn;
        });

        const requestBody = {
            question: userQuestion,
            overrideConfig: { sessionId, vars: { bot_name: botName } },
        };

        if (history.length > 0) {
            requestBody.history = history;
        }

        if (attachment) {
            const response = await fetch(attachment.url);
            if (!response.ok) throw new Error(`첨부파일을 가져오는 데 실패했습니다: ${response.statusText}`);
            const imageBuffer = Buffer.from(await response.arrayBuffer());
            requestBody.uploads = [{ data: imageBuffer.toString('base64'), type: 'file' }];
        }

        aiResponseText = await callFlowise(requestBody, sessionId, 'chat-conversation');
        
        const aiResponse = JSON.parse(aiResponseText);

        let descriptionText = 'AI로부터 답변을 받지 못했습니다.';
        if (typeof aiResponse.text === 'string') {
            descriptionText = aiResponse.text;
        } else if (aiResponse.text) {
            try {
                 descriptionText = '```json\n' + JSON.stringify(aiResponse.text, null, 2) + '\n```';
            } catch (stringifyError) {
                 descriptionText = '[객체를 문자열로 변환 실패]';
            }
        }
    
        const newChat = new Interaction({
            interactionId: interaction.id,
            channelId: interaction.channelId,
            userId: sessionId,
            userName: interaction.user.username,
            type: 'MENTION',
            content: userQuestion,
            botResponse: descriptionText
        });
        await newChat.save();
        console.log(`[Chat Command] '/chat' 대화 내용을 DB에 저장했습니다. (ID: ${interaction.id})`);


        const replyEmbed = new EmbedBuilder()
            .setColor(aiResponse.text.includes('Flowise 에이전트 연결에 실패') ? 0xFFA500 : 0x00FA9A)
            .setDescription(descriptionText)
            .setTimestamp()
            .setFooter({ text: '⚠️ Flowise 오류로 인해 Gemini Flash (Fallback)가 응답했습니다.' });

        if (aiResponse.imageUrl) {
            replyEmbed.setImage(aiResponse.imageUrl);
        }

        await interaction.editReply({ content: `<@${sessionId}>`, embeds: [replyEmbed] });

    } catch (error) {
        
        if (error instanceof SyntaxError && error.message.includes('JSON')) {
            console.error(`[Chat Command] AI 응답 JSON 파싱 실패:`, aiResponseText);
            await logToDiscord(interaction.client, 'ERROR', 'AI 응답을 해석(JSON 파싱)하는 데 실패했습니다.', interaction, error, aiResponseText);
        } else {
            console.error(`[Chat Command] AI 응답 처리 중 오류:`, error);
            await logToDiscord(interaction.client, 'ERROR', 'AI 응답 처리 중 오류가 발생했습니다.', interaction, error, 'handleRegularConversation');
        }

        try {
            const errorInteraction = new Interaction({
                interactionId: interaction.id,
                channelId: interaction.channelId,
                userId: sessionId,
                userName: interaction.user.username,
                type: 'ERROR',
                content: `/chat 질문: ${userQuestion}`,
                botResponse: error.message 
            });
            await errorInteraction.save();
            console.log(`[Chat Command] '/chat' 오류 내역을 DB에 저장했습니다. (ID: ${interaction.id})`);
        } catch (dbError) {
             console.error(`[Chat Command] DB에 오류 내역 저장조차 실패...`, dbError);
             await logToDiscord(interaction.client, 'ERROR', '오류가 발생한 상호작용을 DB에 기록하는 데에도 실패했습니다.', interaction, dbError, 'handleRegularConversation_CATCH');
        }

        await interaction.editReply({ content: `<@${interaction.user.id}> 미안... 응답을 처리하다가 오류가 났어. 😭\n> ${error.message}` }).catch(console.error);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('chat')
        .setDescription('AI와 대화하거나, 저장된 기억을 검색합니다.')
        .setContexts([
            InteractionContextType.Guild,          // 1. 서버
            InteractionContextType.BotDM,          // 2. 봇과의 1:1 DM
            InteractionContextType.PrivateChannel, // 3. 그룹 DM
        ])
        .addStringOption(option =>
            option.setName('question')
                .setDescription('AI에게 할 질문 또는 검색할 내용')
                .setRequired(true))
        .addAttachmentOption(option =>
            option.setName('file')
                .setDescription('AI에게 보여줄 파일을 첨부하세요 (이미지, 코드 등).')
                .setRequired(false)),
    
    async execute(interaction) {
        await interaction.deferReply();
        const userQuestion = interaction.options.getString('question');
        const sessionId = interaction.user.id;

        const filter = await generateMongoFilter(userQuestion, sessionId);
        const searchResults = await Interaction.find(filter).sort({ timestamp: -1 }).limit(5);

        if (searchResults.length > 0) {
            await handleMemoryFound(interaction, searchResults);
        } else {
            await handleRegularConversation(interaction);
        }
    },
};