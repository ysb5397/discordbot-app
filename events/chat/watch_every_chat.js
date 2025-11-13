const { Events } = require('discord.js');
const { Interaction, Urls } = require('../../utils/database');
const { generateAttachmentDescription, callFlowise } = require('../../utils/ai_helper');

const excludeChannelId = "1434714087388086304";
const urlCheckApiKey = process.env.URL_CHECK_API_KEY;

/**
 * AI를 사용하여 문맥에 맞는 답변을 생성하는 함수
 * (Flowise 실패 시 Gemini로 폴백 기능은 callFlowise가 담당)
 * @param {import('discord.js').Message} message - 사용자가 보낸 메시지 객체
 * @returns {Promise<string>} AI가 생성한 답변 문자열
 */
async function generateSmartReply(message) {
    const sessionId = message.author.id;
    const botName = message.client.user.username;
    
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
        question: message.content,
        overrideConfig: { 
            sessionId: `flowise-mention-${sessionId}`,
            vars: { bot_name: botName } 
        },
    };

    if (history.length > 0) {
        requestBody.history = history;
    }
    
    console.log(`[Flowise Mention] '${sessionId}'님의 질문으로 에이전트 호출 시도...`);
    
    const aiResponseText = await callFlowise(requestBody, sessionId, 'mention-reply');
    
    const responseJson = JSON.parse(aiResponseText);
    return responseJson.text || "음... 뭐라고 답해야 할지 모르겠어.";
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function submitNewUrlScan(url) {
    try {
        const submitResponse = await fetch('https://urlscan.io/api/v1/scan', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'API-Key': urlCheckApiKey
            },
            body: JSON.stringify({ "url": url, "visibility": "public" })
        });

        if (!submitResponse.ok) {
            throw new Error(`[${url}] 스캔 제출 실패: ${submitResponse.statusText}`);
        }

        const submitData = await submitResponse.json();
        const resultApiUrl = submitData.api;

        if (!resultApiUrl) {
            throw new Error(`[${url}] 스캔 제출 후 API URL을 받지 못함.`);
        }

        await delay(10000); 

        let resultResponse = null;
        const maxRetries = 5;

        for (let i = 0; i < maxRetries; i++) {
            resultResponse = await fetch(resultApiUrl);

            if (resultResponse.status === 404) {
                await delay(5000);
                continue; 
            }
            
            if (!resultResponse.ok) {
                throw new Error(`[${url}] 결과 조회 실패: ${resultResponse.statusText}`);
            }

            const resultData = await resultResponse.json();
            
            const isMalicious = resultData.verdicts?.overall?.malicious === true;

            return {
                url: url,
                isMalicious: isMalicious,
                reportUrl: resultData.task.reportURL
            };
        }

        throw new Error(`[${url}] 검사 시간 초과.`);

    } catch (err) {
        console.error(err);
        return {
            url: url,
            isMalicious: false,
            error: err.message
        };
    }
}

async function searchUrlScan(url) {
    console.log(`"${url}" 검색 시도...`);
    try {
        const domain = new URL(url).hostname.replace(/^www\./, '');
        
        const searchResponse = await fetch(`https://urlscan.io/api/v1/search/?q=domain:${domain}&size=10`, {
            method: 'GET',
            headers: { 'API-Key': urlCheckApiKey }
        });

        if (!searchResponse.ok) {
            throw new Error(`[${url}] 검색 API 호출 실패: ${searchResponse.statusText}`);
        }

        const searchData = await searchResponse.json();

        if (searchData.results && searchData.results.length > 0) {
            console.log(`"${url}" 검색 히트! (결과 ${searchData.results.length}개 / 새 스캔 안 함)`);
            
            const isMalicious = searchData.results.some(
                result => result.verdicts?.overall?.malicious === true
            );

            const latestReportUrl = searchData.results[0].task.reportURL;
            
            return {
                url: url,
                isMalicious: isMalicious,
                reportUrl: latestReportUrl
            };
        }

        console.log(`"${url}" 검색 결과 없음. 새 스캔 제출...`);
        return await submitNewUrlScan(url);

    } catch (err) {
        console.error(err);
        return {
            url: url,
            isMalicious: false,
            error: err.message
        };
    }
}

async function scanAndReply(urlsToScan, thinkingMessage, cachedReplies = []) {
    
    const scanPromises = urlsToScan.map(url => searchUrlScan(url));
    const results = await Promise.allSettled(scanPromises);

    let allowUrl = [];
    let disallowUrl = [];
    let errorUrl = [];
    const urlsToSaveToDB = [];

    results.forEach(result => {
        if (result.status === 'fulfilled') {
            const data = result.value;
            const link = `[${data.url}](${data.reportUrl || 'about:blank'})`;

            if (data.error) {
                errorUrl.push(`- ${data.url} (검사 중 오류: ${data.error})`);
            } else if (data.isMalicious) {
                disallowUrl.push(`- ${link} ☠️`);
            } else {
                allowUrl.push(`- ${link} ✅`);
            }

            urlsToSaveToDB.push({
                url: data.url,
                isSafe: !data.isMalicious,
                lastChecked: new Date()
            });

        } else {
            errorUrl.push(`- 알 수 없는 URL (치명적 오류: ${result.reason.message})`);
        }
    });
    
    console.log(`${urlsToSaveToDB.length}`);
    if (urlsToSaveToDB.length > 0) {
        try {
            await Urls.insertMany(urlsToSaveToDB, { ordered: false }); // 중복 에러 무시
            console.log(`[DB] ${urlsToSaveToDB.length}개의 새 URL 검사 결과를 저장했습니다.`);
        } catch (dbError) {
            if (!dbError.message.includes('E11000')) {
                console.error(`[DB] URL 저장 실패:`, dbError);
            }
            throw Error(dbError);
        }
    }
    
    const totalCount = urlsToScan.length + cachedReplies.length;
    let description = [`**총 ${totalCount}개 URL 검사 완료!**\n`];

    if (cachedReplies.length > 0) {
        description.push(`**[ 💾 캐시된 결과 ${cachedReplies.length}개 ]**\n${cachedReplies.join('\n')}\n`);
    }

    if (disallowUrl.length > 0) {
        description.push(`**[ 🚨 신규 위험 ${disallowUrl.length}개 ]**\n${disallowUrl.join('\n')}\n`);
    }
    if (allowUrl.length > 0) {
        description.push(`**[ ✅ 신규 안전 ${allowUrl.length}개 ]**\n${allowUrl.join('\n')}\n`);
    }
    if (errorUrl.length > 0) {
        description.push(`**[ ⚠️ 오류 ${errorUrl.length}개 ]**\n${errorUrl.join('\n')}`);
    }

    try {
        await thinkingMessage.edit({ 
            content: description.join('\n')
        });
    } catch (editError) {
        console.error("결과 메시지 수정 실패:", editError);
    }
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        if (client.amIActive === false) {
            return;
        }

        if (message.author.bot) return;
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        let foundUrls = message.content.match(urlRegex);

        let thinkingMessage = null;
        if (foundUrls) {
            foundUrls = [...new Set(foundUrls)];
            const urlsToScan = [];
            const cachedReplies = [];

            for (const url of foundUrls) {
                console.log(`[로그 1] 검사할 URL: ${url}`);
                const cached = await Urls.findOne({ url: url });
                
                console.log(`[로그 2] 캐시에서 찾음?:`, cached); // null이 나와야 정상!
                if (cached) {
                    if (!cached.isSafe) {
                        try {
                            await message.delete();
                        } catch (err) {
                            console.error("메시지 삭제 권한이 없거나 이미 삭제된 메시지입니다.", err);
                        }
                        await message.channel.send(
                            `${message.author} 님, 메시지에 캐시된 위험 링크(${url})가 포함되어 있어 삭제했어요! ☠️`
                        );
                        return;
                    } else {
                        const status = '안전 ✅';
                        cachedReplies.push(`- ${url} (이미 검사됨: ${status})`);
                    }
                } else {
                    urlsToScan.push(url);
                }
            }
            console.log(`[로그 3] 최종 스캔 목록:`, urlsToScan); // 여기에 새 링크가 담겨야 함!

            if (urlsToScan.length > 0) {
                const cachedCount = cachedReplies.length;
                const thinkingMessage = await message.reply(
                    `${urlsToScan.length}개의 새 링크를 검사할게. (캐시된 안전 링크 ${cachedCount}개) 잠시만 기다려줘!`
                );
                
                await scanAndReply(urlsToScan, thinkingMessage, cachedReplies); 

            } else if (cachedReplies.length > 0) {
                await message.reply(`감지된 링크는 모두 이전에 검사 완료된 안전한 링크들이야!\n\n${cachedReplies.join('\n')}`);
            }
            
            return;
        }

        if (message.channelId == excludeChannelId) return;

        const shouldBotReply = message.mentions.has(client.user);

        if (shouldBotReply) {
            try {
                thinkingMessage = await message.reply("잠깐만... 생각 중이야! 🤔");
            } catch (replyError) {
                try {
                    thinkingMessage = await message.channel.send("잠깐만... 생각 중이야! 🤔");
                } catch (sendError) {
                    console.error("멘션 응답 '생각 중' 메시지 전송 실패:", sendError);
                    return;
                }
            }

            try {
                const botReplyText = await generateSmartReply(message);

                const newMention = new Interaction({
                    interactionId: message.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: message.author.username,
                    type: 'MENTION',
                    content: message.content,
                    botResponse: botReplyText
                });
                await newMention.save();
                await thinkingMessage.edit(botReplyText);

            } catch (error) {
                // (유지) generateSmartReply가 실패했을 때의 최종 방어선
                console.error('봇 답변 처리/수정 중 오류 발생:', error);
                
                if (thinkingMessage) {
                    await thinkingMessage.edit("미안, 지금은 생각 회로에 문제가 생긴 것 같아... 😵");
                }
                
                // (유지) 실패 기록을 DB에 저장
                const newError = new Interaction({
                    interactionId: message.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: message.author.username,
                    type: 'ERROR',
                    content: `멘션 답변 생성/수정 실패: ${message.content}`,
                    botResponse: error.message
                });
                await newError.save();
            }

        } else {
            let contentToSave = message.content;

            if (message.attachments.size > 0 && message.content.trim() === '') {
                 if (message.attachments.size >= 5) {
                    await message.react('❌');
                    await message.reply('파일 분석은 한 번에 4개까지만 가능해! 😵');
                    return;
                }
                
                await message.react('🤔');

                const attachmentPromises = message.attachments.map(att => generateAttachmentDescription(att));

                const results = await Promise.all(attachmentPromises);
                contentToSave = results.join('\n\n');
                
                await message.reactions.cache.get('🤔')?.remove();
                await message.react('✅');
            }

            if (contentToSave.trim() !== '') {
                const newMessage = new Interaction({
                    interactionId: message.id,
                    channelId: message.channel.id,
                    userId: message.author.id,
                    userName: message.author.username,
                    type: 'MESSAGE',
                    content: contentToSave
                });
                await newMessage.save();
                console.log(`'${message.author.username}'의 메시지를 저장했습니다: "${contentToSave.substring(0, 50)}..."`);
            }
        }
    },
};