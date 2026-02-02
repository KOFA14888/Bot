
// fishing_bot.js - Бот с нормальной рыбалкой (как в FishingBot)
const mineflayer = require('mineflayer')
const Vec3 = require('vec3')

const express = require('express')
const http = require('http')
const socketIo = require('socket.io')
const fs = require('fs')
const path = require('path')

const app = express()
const server = http.createServer(app)
const io = socketIo(server)

// Хранилище ботов
const bots = {}
const botConfigs = {}
const savedBotsFile = 'saved_bots.json'

// Загрузка сохраненных ботов
function loadSavedBots() {
    try {
        if (fs.existsSync(savedBotsFile)) {
            const data = fs.readFileSync(savedBotsFile, 'utf8')
            return JSON.parse(data)
        }
    } catch (error) {
        console.log('❌ Ошибка загрузки сохраненных ботов:', error.message)
    }
    return []
}

// Сохранение ботов
function saveBots() {
    try {
        const botsToSave = Object.keys(bots).map(botId => {
            const config = botConfigs[botId]
            return {
                id: botId,
                host: config?.host || 'rar4423.aternos.me',
                port: config?.port || 45550,
                username: config?.username || 'Fisher',
                password: config?.password || '123123qwerty',
                autoRegister: config?.autoRegister || true,
                autoLogin: config?.autoLogin || true,
                commandAfterLogin: config?.commandAfterLogin || '/an602',
                commandDelay: config?.commandDelay || 60000,
                enabled: config?.enabled || false
            }
        })
        
        fs.writeFileSync(savedBotsFile, JSON.stringify(botsToSave, null, 2))
        console.log('💾 Боты сохранены')
    } catch (error) {
        console.log('❌ Ошибка сохранения ботов:', error.message)
    }
}

// НОРМАЛЬНАЯ РЫБАЛКА (исправленная и улучшенная)
function setupFishing(bot, botConfig, addLog) {
    let bobberEntity = null
    let lastBobberPosition = null
    let isReeling = false // Флаг, чтобы избежать повторных подсечек
    let recastTimeout = null // Таймаут для автоматического перезаброса
    let fishCaught = 0
    let lastRodUse = 0 // Для предотвращения спама забросами
    let bobberTrackingInterval = null // Интервал для отслеживания движения поплавка
    let isFishingActive = false // Общий флаг активности рыбалки

    // Вспомогательная функция для задержки
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

    // Проверка, находится ли бот у воды
    function isNearWater() {
        if (!bot.entity) return false;
        const pos = bot.entity.position;
        // Проверяем блоки вокруг бота на наличие воды
        // Проверяем блоки на уровне ног и чуть ниже
        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                // Блок под ногами
                const blockUnder = bot.blockAt(pos.offset(x, -1, z));
                if (blockUnder && (blockUnder.name === 'water' || blockUnder.name === 'flowing_water')) {
                    return true;
                }
                // Блок на уровне ног (если бот стоит в воде)
                const blockAtFeet = bot.blockAt(pos.offset(x, 0, z));
                if (blockAtFeet && (blockAtFeet.name === 'water' || blockAtFeet.name === 'flowing_water')) {
                    return true;
                }
            }
        }
        return false;
    }

    // Основная функция рыбалки
    async function startFishing() {
        if (isFishingActive) {
            addLog('🎣 Рыбалка уже идет');
            return false;
        }

        if (!isNearWater()) {
            addLog('❌ Бот не находится у воды. Не могу начать рыбалку.');
            return false;
        }

        const fishingRod = findBestFishingRod();
        if (!fishingRod) {
            addLog('❌ Нет удочки в инвентаре!');
            return false;
        }

        // Проверка и переключение удочки, если текущая почти сломалась
        if (isRodAboutToBreak(fishingRod)) {
            const switched = await switchToBetterRod();
            if (!switched) {
                addLog('❌ Удочка почти сломалась и нет запасной! Рыбалка отменена.');
                return false;
            }
        }

        isFishingActive = true;
        botConfig.fishing = true; // Обновляем состояние в конфиге для UI
        isReeling = false;
        fishCaught = 0;

        try {
            await bot.equip(fishingRod, 'hand');
            addLog('🎣 Экипировал удочку');
            await sleep(500); // Небольшая задержка после экипировки
            castRod(); // Начинаем цикл заброса
        } catch (err) {
            addLog(`❌ Ошибка экипировки удочки: ${err.message}`);
            isFishingActive = false;
            botConfig.fishing = false;
            return false;
        }

        return true;
    }

    function findBestFishingRod() {
        const rods = bot.inventory.items().filter(item =>
            item && item.name.includes('fishing_rod')
        );

        if (rods.length === 0) return null;

        // Выбираем удочку с наибольшей оставшейся прочностью
        rods.sort((a, b) => {
            const aRemaining = a.maxDurability ? (a.maxDurability - a.durability) : 0;
            const bRemaining = b.maxDurability ? (b.maxDurability - b.durability) : 0;
            return bRemaining - aRemaining; // Сортировка по убыванию оставшейся прочности
        });

        return rods[0];
    }

    function isRodAboutToBreak(rod) {
        if (!rod || !rod.maxDurability) return false;
        const remainingDurability = rod.maxDurability - rod.durability;
        return remainingDurability < 10; // Если осталось менее 10 использований
    }

    async function switchToBetterRod() {
        const rods = bot.inventory.items().filter(item =>
            item && item.name.includes('fishing_rod') && !isRodAboutToBreak(item)
        );

        if (rods.length === 0) {
            addLog('❌ Нет запасных удочек в хорошем состоянии!');
            return false;
        }

        const bestRod = rods.sort((a, b) => {
            const aRemaining = a.maxDurability ? (a.maxDurability - a.durability) : 0;
            const bRemaining = b.maxDurability ? (b.maxDurability - b.durability) : 0;
            return bRemaining - aRemaining;
        })[0];

        try {
            await bot.equip(bestRod, 'hand');
            addLog(`🔄 Переключился на свежую удочку: ${bestRod.displayName}`);
            return true;
        } catch (err) {
            addLog(`❌ Ошибка переключения на запасную удочку: ${err.message}`);
            return false;
        }
    }

    async function castRod() {
        if (!isFishingActive || !bot.entity || isReeling) return; // Не забрасываем, если рыбалка неактивна или уже подсекаем

        const now = Date.now();
        if (now - lastRodUse < 1500) { // Защита от спама, минимум 1.5 секунды между забросами
            addLog('⏱️ Слишком быстро, жду перед забросом...');
            await sleep(1500 - (now - lastRodUse));
        }
        lastRodUse = now;

        bobberEntity = null;
        lastBobberPosition = null;

        if (recastTimeout) {
            clearTimeout(recastTimeout);
            recastTimeout = null;
        }
        if (bobberTrackingInterval) {
            clearInterval(bobberTrackingInterval);
            bobberTrackingInterval = null;
        }

        try {
            await bot.activateItem(); // Забрасываем удочку
            addLog('🎣 Забросил удочку');
            // Устанавливаем таймаут для автоматического перезаброса, если поклевка не произошла
            recastTimeout = setTimeout(() => {
                if (isFishingActive && bot.entity && !isReeling) {
                    addLog('⏱️ Перезабрасываю удочку (таймаут)');
                    recastRod();
                }
            }, 30000 + Math.random() * 15000); // От 30 до 45 секунд
        } catch (err) {
            addLog(`❌ Ошибка заброса удочки: ${err.message}`);
            // Если заброс не удался, пробуем снова через некоторое время
            if (isFishingActive) {
                await sleep(2000);
                castRod();
            }
        }
    }

    async function recastRod() {
        if (!isFishingActive || !bot.entity || isReeling) return;

        addLog('🔄 Перезабрасываю удочку...');
        isReeling = true; // Устанавливаем флаг, чтобы предотвратить другие действия

        if (recastTimeout) {
            clearTimeout(recastTimeout);
            recastTimeout = null;
        }
        if (bobberTrackingInterval) {
            clearInterval(bobberTrackingInterval);
            bobberTrackingInterval = null;
        }

        try {
            await bot.activateItem(); // Подсекаем (убираем удочку)
            addLog('🎣 Убрал удочку для перезаброса');
            await sleep(1000); // Ждем, пока анимация завершится

            isReeling = false; // Сбрасываем флаг перед новым забросом
            if (isFishingActive && bot.entity) {
                castRod(); // Забрасываем снова
            }
        } catch (err) {
            addLog(`❌ Ошибка при перезабросе (подсечке): ${err.message}`);
            isReeling = false;
            // Если произошла ошибка, можно попробовать забросить снова или остановить рыбалку
            if (isFishingActive) {
                await sleep(2000);
                castRod();
            }
        }
    }

    async function stopFishing() {
        if (!isFishingActive) return;

        isFishingActive = false;
        botConfig.fishing = false; // Обновляем состояние в конфиге для UI
        bobberEntity = null;
        lastBobberPosition = null;
        isReeling = false;

        if (recastTimeout) {
            clearTimeout(recastTimeout);
            recastTimeout = null;
        }
        if (bobberTrackingInterval) {
            clearInterval(bobberTrackingInterval);
            bobberTrackingInterval = null;
        }

        try {
            // Убираем удочку, если она в руке
            if (bot.heldItem && bot.heldItem.name.includes('fishing_rod')) {
                await bot.deactivateItem();
                addLog('🎣 Удочка убрана.');
            }
        } catch (err) {
            addLog(`❌ Ошибка при деактивации удочки: ${err.message}`);
        }
        addLog('🎣 Рыбалка остановлена');
    }

    // --- Отслеживание поплавка и поклевки ---

    // Событие спавна сущности (поплавка)
    bot.on('entitySpawn', (entity) => {
        if (entity.name === 'fishing_bobber' && isFishingActive) {
            // Убеждаемся, что это наш поплавок
            // Mineflayer 4.x обычно связывает owner с сущностью игрока
            if (entity.owner && entity.owner.id === bot.entity.id) {
                bobberEntity = entity;
                lastBobberPosition = entity.position.clone();
                addLog('🎣 Мой поплавок в воде');

                // Запускаем отслеживание движения поплавка
                if (!bobberTrackingInterval) {
                    bobberTrackingInterval = setInterval(trackBobber, 50); // Чаще проверяем движение
                }
            }
        }
    });

    // Событие исчезновения сущности (поплавка)
    bot.on('entityGone', (entity) => {
        if (entity === bobberEntity && isFishingActive && !isReeling) {
            // Поплавок исчез - это поклевка!
            addLog('🎣 Клюет! (поплавок исчез)');
            handleFishBite();
        }
    });

    // Отслеживание движения поплавка (дополнительный индикатор поклевки)
    function trackBobber() {
        if (!isFishingActive || !bobberEntity || !lastBobberPosition || isReeling) return;

        const currentPos = bobberEntity.position;
        const deltaY = currentPos.y - lastBobberPosition.y;

        // Определяем резкое движение поплавка вниз (поклевка)
        // Значение -0.05 может потребовать настройки в зависимости от сервера и версии
        if (deltaY < -0.05) {
            addLog('🎣 Клюет! (резкое движение поплавка)');
            handleFishBite();
            return;
        }

        lastBobberPosition = currentPos.clone();
    }

    // Обработка поклевки
    async function handleFishBite() {
        if (isReeling || !isFishingActive) return;

        isReeling = true; // Устанавливаем флаг, чтобы избежать повторных подсечек

        // Очищаем таймауты и интервалы
        if (recastTimeout) {
            clearTimeout(recastTimeout);
            recastTimeout = null;
        }
        if (bobberTrackingInterval) {
            clearInterval(bobberTrackingInterval);
            bobberTrackingInterval = null;
        }

        bobberEntity = null; // Сбрасываем поплавок, так как он будет подсечен

        try {
            await bot.activateItem(); // Подсекаем!
            addLog('🎣 Подсекаю!');
            await sleep(1000 + Math.random() * 500); // Ждем 1-1.5 секунды после подсечки

            isReeling = false; // Сбрасываем флаг
            if (isFishingActive && bot.entity) {
                castRod(); // Забрасываем удочку снова
            }
        } catch (err) {
            addLog(`❌ Ошибка при подсечке: ${err.message}`);
            isReeling = false;
            // Если подсечка не удалась, пробуем забросить снова
            if (isFishingActive) {
                await sleep(2000);
                castRod();
            }
        }
    }

    // Подбор рыбы
    bot.on('playerCollect', (collector, collected) => {
        if (collector === bot.entity && isFishingActive) {
            const itemName = collected.displayName || collected.name;
            if (itemName.toLowerCase().includes('fish') ||
                itemName.includes('cod') ||
                itemName.includes('salmon') ||
                itemName.includes('pufferfish') ||
                itemName.includes('tropical')) {

                fishCaught++;
                addLog(`🐟 Поймал ${itemName}! Всего: ${fishCaught}`);
            } else {
                addLog(`📦 Подобрал: ${itemName} (x${collected.count})`); // Логирование других предметов
            }
            // Можно добавить логику для проверки инвентаря и сброса мусора
        }
    });

    // Возвращаем функции для управления рыбалкой
    return {
        startFishing,
        stopFishing
    };
}

// Создание бота
function createBot(botId, config) {
    console.log(`🤖 Создаю бота: ${config.username}`)
    
    try {
        const bot = mineflayer.createBot({
            host: config.host || 'rar4423.aternos.me',
            port: config.port || 45550,
            username: config.username || `Fisher_${Date.now()}`,
            version: '1.16.5', // Убедитесь, что версия соответствует серверу
            auth: 'offline',
            hideErrors: false
        })
        
        // Конфигурация бота
        botConfigs[botId] = {
            id: botId,
            host: config.host,
            port: config.port,
            username: config.username,
            password: config.password || '123123qwerty',
            autoRegister: config.autoRegister !== false,
            autoLogin: config.autoLogin !== false,
            commandAfterLogin: config.commandAfterLogin || '/an602',
            commandDelay: config.commandDelay || 60000,
            enabled: true,
            fishing: false, // Изначально рыбалка выключена
            online: false,
            chatMessages: [],
            awaitingRegistration: false,
            awaitingLogin: false,
            commandSent: false,
            joinTime: null,
            logs: [],
            captchaAttempts: {}
        }
        
        const botConfig = botConfigs[botId]
        
        // Логирование
        function addLog(message) {
            const logEntry = {
                time: new Date().toLocaleTimeString(),
                message: message
            }
            botConfig.logs.push(logEntry)
            if (botConfig.logs.length > 50) {
                botConfig.logs.shift()
            }
            
            io.emit('botLog', { 
                botId, 
                log: `[${logEntry.time}] ${logEntry.message}` 
            })
            
            console.log(`[${config.username}] ${message}`)
        }
        
        // Инициализация рыбалки
        const fishingSystem = setupFishing(bot, botConfig, addLog)
        
        // Обновление состояния
        function updateBotState() {
            if (!bot || !bot.entity) return
            
            const inventory = getInventory(bot)
            
            const state = {
                botId,
                username: bot.username,
                health: Math.floor(bot.health || 20),
                food: Math.floor(bot.food || 20),
                position: {
                    x: Math.floor(bot.entity.position.x),
                    y: Math.floor(bot.entity.position.y),
                    z: Math.floor(bot.entity.position.z)
                },
                fishing: botConfig.fishing,
                online: botConfig.online,
                enabled: botConfig.enabled,
                inventory: inventory
            }
            
            io.emit('botState', state)
        }
        
        // Отправка команды через минуту
        function scheduleCommand() {
            setTimeout(() => {
                if (botConfig.enabled && bot.entity && !botConfig.commandSent) {
                    bot.chat(botConfig.commandAfterLogin)
                    botConfig.commandSent = true
                    addLog(`📝 Отправил команду через минуту: ${botConfig.commandAfterLogin}`)
                }
            }, botConfig.commandDelay)
        }
        
        // Обработка капчи
        function handleCaptcha(message) {
            const digitMatch = message.match(/\b\d{4,6}\b/)
            if (digitMatch) {
                const captchaCode = digitMatch[0]
                
                if (!botConfig.captchaAttempts[captchaCode]) {
                    botConfig.captchaAttempts[captchaCode] = 1
                    
                    setTimeout(() => {
                        if (botConfig.enabled && bot.entity) {
                            bot.chat(captchaCode)
                            addLog(`🔐 Отправил капчу: ${captchaCode}`)
                        }
                    }, 1500 + Math.random() * 2000)
                    
                    return true
                }
            }
            return false
        }
        
        // Авто-логин
        function handleLogin(message) {
            if (message.includes('/login') && 
                !botConfig.awaitingLogin && 
                !message.includes(botConfig.password)) {
                
                botConfig.awaitingLogin = true
                
                setTimeout(() => {
                    if (botConfig.enabled && bot.entity) {
                        bot.chat(`/login ${botConfig.password}`)
                        addLog(`🔐 Отправляю логин`)
                        botConfig.awaitingLogin = false
                    }
                }, 2000)
                
                return true
            }
            return false
        }
        
        // Авто-регистрация
        function handleRegistration(message) {
            if ((message.includes('/reg') || message.includes('/register')) && 
                !botConfig.awaitingLogin) {
                
                setTimeout(() => {
                    if (botConfig.enabled && bot.entity) {
                        bot.chat(`/reg ${botConfig.password} ${botConfig.password}`)
                        addLog('📝 Отправляю регистрацию')
                    }
                }, 2000 + Math.random() * 2000)
                
                return true
            }
            return false
        }
        
        // События бота
        bot.on('login', () => {
            addLog('✅ Подключился к серверу')
            botConfig.online = true
            botConfig.joinTime = Date.now()
            botConfig.commandSent = false
            botConfig.captchaAttempts = {}; // Очищаем попытки капчи после успешного входа
            broadcastBotList()
            
            scheduleCommand()
        })
        
        bot.on('spawn', () => {
            addLog('📍 Появился в мире')
            updateBotState()
        })
        
        bot.on('chat', (username, message) => {
            if (username === bot.username) return
            
            botConfig.chatMessages.push({
                username,
                message,
                time: new Date().toLocaleTimeString()
            })
            
            if (botConfig.chatMessages.length > 50) {
                botConfig.chatMessages.shift()
            }
            
            io.emit('botChat', { 
                botId, 
                username, 
                message,
                time: new Date().toLocaleTimeString()
            })
            
            // Капча
            if (message.toLowerCase().includes('введите номер') || 
                message.toLowerCase().includes('captcha') ||
                message.toLowerCase().includes('код с картинки')) {
                handleCaptcha(message)
            }
            
            // Авто-логин
            if (botConfig.autoLogin) {
                handleLogin(message)
            }
            
            // Авто-регистрация
            if (botConfig.autoRegister) {
                handleRegistration(message)
            }
            
            // Команды управления
            if (username === 'admin' || message.startsWith('!бот')) {
                const args = message.split(' ')
                const command = args[1]
                
                switch(command) {
                    case 'рыба':
                        fishingSystem.startFishing()
                        break
                    case 'стоп':
                        fishingSystem.stopFishing()
                        break
                    case 'команда':
                        if (args[2]) {
                            bot.chat(args[2])
                            addLog(`📝 Отправил команду: ${args[2]}`)
                        }
                        break
                }
            }
        })
        
        bot.on('health', () => {
            updateBotState()
        })
        
        bot.on('death', () => {
            addLog('💀 Умер')
            fishingSystem.stopFishing()
            updateBotState()
        })
        
        bot.on('kicked', (reason) => {
            botConfig.online = false
            addLog(`🚫 Кикнут: ${reason}`)
            fishingSystem.stopFishing()
            broadcastBotList()
        })
        
        bot.on('end', () => {
            botConfig.online = false
            fishingSystem.stopFishing()
            broadcastBotList()
        })
        
        bot.on('error', (err) => {
            addLog(`❌ Ошибка: ${err.message}`)
        })
        
        // Сохраняем системы
        botConfig.fishingSystem = fishingSystem
        
        // Периодическое обновление
        setInterval(() => {
            if (botConfig.enabled && bot.entity) {
                updateBotState()
            }
        }, 2000)
        
        bots[botId] = bot
        return bot
        
    } catch (error) {
        console.log('❌ Ошибка создания бота:', error.message)
        return null
    }
}

// Вспомогательные функции
function getInventory(bot) {
    try {
        const items = bot.inventory?.items() || []
        const inventory = {
            total: items.length,
            items: [],
            summary: {
                fishingRods: 0,
                fish: 0,
                other: 0
            }
        }
        
        items.forEach(item => {
            const itemInfo = {
                name: item.displayName || item.name.replace(/_/g, ' '),
                count: item.count,
                type: item.name
            }
            
            inventory.items.push(itemInfo)
            
            if (item.name.includes('fishing_rod')) {
                inventory.summary.fishingRods++
            } else if (item.name.includes('fish')) {
                inventory.summary.fish += item.count
            } else {
                inventory.summary.other += item.count
            }
        })
        
        return inventory
    } catch (error) {
        return {
            total: 0,
            items: [],
            summary: {
                fishingRods: 0,
                fish: 0,
                other: 0
            }
        }
    }
}

function broadcastBotList() {
    const botList = Object.keys(bots).map(botId => {
        const config = botConfigs[botId]
        return {
            id: botId,
            username: config?.username || 'Unknown',
            online: config?.online || false,
            fishing: config?.fishing || false,
            enabled: config?.enabled || false,
            host: config?.host || 'Unknown',
            port: config?.port || 0
        }
    })
    
    io.emit('botList', botList)
}

// Веб-сервер
app.use(express.json())
app.use(express.static('public'))

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.post('/api/bots', (req, res) => {
    const { host, port, username, password, autoRegister, autoLogin } = req.body
    
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const bot = createBot(botId, {
        host: host || 'rar4423.aternos.me',
        port: port || 45550,
        username: username || `Fisher_${Object.keys(bots).length + 1}`,
        password: password || '123123qwerty',
        autoRegister: autoRegister !== false,
        autoLogin: autoLogin !== false,
        commandAfterLogin: '/an602',
        commandDelay: 60000
    })
    
    if (bot) {
        broadcastBotList()
        saveBots()
        res.json({ 
            success: true, 
            botId, 
            username: bot.username,
            message: 'Бот создан' 
        })
    } else {
        res.status(500).json({ 
            success: false, 
            message: 'Не удалось создать бота' 
        })
    }
})

app.post('/api/bots/:botId/command', (req, res) => {
    const { botId } = req.params
    const { command, args } = req.body
    
    let result = { success: false, message: 'Неизвестная команда' }
    
    try {
        const bot = bots[botId]
        const config = botConfigs[botId]
        
        if (!bot || !config) {
            result.message = 'Бот не найден'
            return res.json(result)
        }
        
        switch (command) {
            case 'fish_start':
                if (config.fishingSystem) {
                    // Используем async/await для вызова startFishing
                    config.fishingSystem.startFishing().then(success => {
                        result.success = success;
                        result.message = success ? 'Начинаю рыбалку' : 'Не удалось начать рыбалку';
                        res.json(result);
                    });
                    return; // Возвращаемся, чтобы не отправлять ответ дважды
                }
                break;
                
            case 'fish_stop':
                if (config.fishingSystem) {
                    config.fishingSystem.stopFishing();
                    result.success = true;
                    result.message = 'Рыбалка остановлена';
                }
                break;
                
            case 'chat':
                if (args && args[0]) {
                    bot.chat(args[0])
                    result.success = true
                    result.message = 'Сообщение отправлено'
                }
                break
                
            case 'quit':
                if (bot) {
                    if (config.fishingSystem) config.fishingSystem.stopFishing()
                    bot.quit()
                    delete bots[botId]
                    delete botConfigs[botId]
                    broadcastBotList()
                    saveBots()
                    result.success = true
                    result.message = 'Бот удален'
                }
                break
        }
    } catch (error) {
        result.message = `Ошибка: ${error.message}`
    }
    
    res.json(result)
})

// WebSocket
io.on('connection', (socket) => {
    console.log('🌐 Подключен клиент')
    broadcastBotList()
})

// Автоматическое создание сохраненных ботов
setTimeout(() => {
    const savedBots = loadSavedBots()
    savedBots.forEach(bot => {
        // Создаем бота, но не запускаем рыбалку автоматически,
        // чтобы пользователь мог решить, когда ее начать.
        // Состояние 'enabled' из saved_bots.json теперь контролирует,
        // должен ли бот вообще быть запущен при старте сервера.
        if (bot.enabled) {
            createBot(bot.id, bot)
        }
    })
}, 2000)

// Запуск сервера
const PORT = 3000
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на http://localhost:${PORT}`)
    console.log(`🎣 Fishing Bot (исправленный) готов к работе!`)
})

// Минимальный package.json
/*
{
  "name": "fishing-bot",
  "version": "1.0.0",
  "description": "Бот для рыбалки в Minecraft",
  "main": "fishing_bot.js",
  "scripts": {
    "start": "node fishing_bot.js"
  },
  "dependencies": {
    "mineflayer": "^4.8.0",
    "express": "^4.18.2",
    "socket.io": "^4.7.2"
  }
}
*/
