const { ipcRenderer } = require('electron');
const { Client, Authenticator } = require('minecraft-launcher-core');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Настройки по умолчанию
const defaultSettings = {
    memory: {
        min: "2G",
        max: "4G"
    },
    javaPath: "",
    gameDir: path.join(__dirname, 'minecraft')
};

// Загрузка настроек
let settings = JSON.parse(localStorage.getItem('launcher-settings') || JSON.stringify(defaultSettings));

// Проверка и создание директорий
const modsDir = path.join(settings.gameDir, 'mods');
if (!fs.existsSync(modsDir)) {
    fs.mkdirSync(modsDir, { recursive: true });
}

// Проверка и создание директории для скинов
const skinsDir = path.join(__dirname, 'skins');
if (!fs.existsSync(skinsDir)) {
    fs.mkdirSync(skinsDir, { recursive: true });
}

// Создаем прогресс-бар
function showProgress(show = true) {
    if (show) {
        toggleProgressBar(true);
    } else {
        toggleProgressBar(false);
    }
}

function formatSpeed(bytesPerSecond) {
    if (bytesPerSecond >= 1024 * 1024) {
        return `${(bytesPerSecond / 1024 / 1024).toFixed(2)} MB/s`;
    } else if (bytesPerSecond >= 1024) {
        return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
    }
    return `${bytesPerSecond.toFixed(2)} B/s`;
}

function updateProgress(options) {
    const progressBar = document.querySelector('.progress-bar');
    const progressStatus = document.querySelector('.progress-status');
    const progressDetails = document.querySelector('.progress-details');
    const progressContainer = document.getElementById('progress-container');

    if (progressBar && progressStatus && progressDetails) {
        const percent = Math.round(options.progress * 100);
        progressBar.style.width = `${percent}%`;
        progressStatus.textContent = options.status || 'Установка...';
        progressDetails.textContent = options.speed ? `${percent}% | ${options.speed}` : `${percent}%`;
        
        if (percent > 0 && !progressContainer.classList.contains('visible')) {
            toggleProgressBar(true);
        }
        
        if (percent === 100) {
            setTimeout(() => {
                toggleProgressBar(false);
            }, 1000);
        }
    }
}

// Выбор папки
async function selectFolder() {
    try {
        const result = await ipcRenderer.invoke('select-folder');
        if (result.canceled) return null;
        return result.filePaths[0];
    } catch (err) {
        console.error('Ошибка выбора папки:', err);
        return null;
    }
}

// Выбор файла
async function selectFile(options = {}) {
    try {
        const result = await ipcRenderer.invoke('select-file', options);
        if (result.canceled) return null;
        return result.filePaths[0];
    } catch (err) {
        console.error('Ошибка выбора файла:', err);
        return null;
    }
}

// Window controls
const minimizeButton = document.getElementById('minimize-button');
if (minimizeButton) {
    minimizeButton.addEventListener('click', () => {
        ipcRenderer.send('minimize-window');
    });
}

const maximizeButton = document.getElementById('maximize-button');
if (maximizeButton) {
    maximizeButton.addEventListener('click', () => {
        ipcRenderer.send('maximize-window');
    });
}

const closeButton = document.getElementById('close-button');
if (closeButton) {
    closeButton.addEventListener('click', () => {
        ipcRenderer.send('close-window');
    });
}

// Minecraft launcher functionality
const launcher = new Client();

// Управление профилями
let profiles = JSON.parse(localStorage.getItem('minecraft-profiles') || '[]');
let selectedProfileIndex = parseInt(localStorage.getItem('selected-profile-index') || '0');
let selectedSkinPath = '';

// Переменные для хранения состояния
let currentVersionType = 'vanilla';

// Функция для загрузки списка версий Minecraft
async function loadMinecraftVersions(selectElement) {
    try {
        const response = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
        const data = await response.json();
        
        // Очищаем список
        selectElement.innerHTML = '<option value="">Выберите версию Minecraft</option>';
        
        // Добавляем только стабильные версии
        data.versions.forEach(version => {
            if (version.type === 'release') {
                const option = document.createElement('option');
                option.value = version.id;
                option.textContent = version.id;
                selectElement.appendChild(option);
            }
        });

        return data.versions.filter(v => v.type === 'release');
    } catch (error) {
        console.error('Ошибка загрузки версий:', error);
        return [];
    }
}

async function showAddProfileDialog() {
    currentVersionType = 'vanilla';
    selectedSkinPath = '';
    
    const dialog = document.createElement('div');
    dialog.className = 'dialog-overlay';
    dialog.innerHTML = `
        <div class="dialog">
            <h2>Новый профиль</h2>
            <div class="dialog-content">
                <div class="input-group">
                    <label>Никнейм:</label>
                    <input type="text" id="profile-username" placeholder="Введите никнейм">
                </div>
                <div class="input-group">
                    <label>Версия Minecraft:</label>
                    <select id="profile-version">
                        <option value="">Загрузка версий...</option>
                    </select>
                </div>
                <div class="input-group">
                    <label>Тип загрузчика:</label>
                    <div class="version-buttons">
                        <button id="profile-vanilla" class="version-button active">Vanilla</button>
                        <button id="profile-fabric" class="version-button">Fabric</button>
                        <button id="profile-forge" class="version-button">Forge</button>
                    </div>
                </div>
                <div class="input-group">
                    <label>Скин:</label>
                    <div class="skin-selector">
                        <div id="skin-preview" class="skin-preview">
                            <div class="no-skin">Без скина</div>
                        </div>
                        <div class="skin-buttons">
                            <button onclick="selectSkinFile()">Выбрать файл</button>
                            <button onclick="clearSkinSelection()">Сбросить</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="dialog-buttons">
                <button id="save-profile-button">Сохранить</button>
                <button id="cancel-profile-button">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
    
    // Добавляем класс visible с небольшой задержкой для анимации
    setTimeout(() => {
        dialog.querySelector('.dialog').classList.add('visible');
    }, 10);

    // Загружаем версии
    const versionSelect = document.getElementById('profile-version');
    await loadMinecraftVersions(versionSelect);
    
    // Настраиваем обработчики для кнопок выбора типа версии
    function setVersionType(type) {
        currentVersionType = type;
        document.querySelectorAll('.dialog .version-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(`profile-${type}`).classList.add('active');
    }
    
    document.getElementById('profile-vanilla').addEventListener('click', () => setVersionType('vanilla'));
    document.getElementById('profile-fabric').addEventListener('click', () => setVersionType('fabric'));
    document.getElementById('profile-forge').addEventListener('click', () => setVersionType('forge'));
    
    // Обработчики для кнопок
    document.getElementById('save-profile-button').addEventListener('click', saveNewProfile);
    document.getElementById('cancel-profile-button').addEventListener('click', closeDialog);
}

window.saveNewProfile = function() {
    const username = document.getElementById('profile-username').value;
    const version = document.getElementById('profile-version').value;
    
    if (!username) {
        alert('Введите никнейм!');
        return;
    }
    
    if (!version) {
        alert('Выберите версию!');
        return;
    }
    
    let skinPath = '';
    
    // Если выбран скин, копируем его в папку skins
    if (selectedSkinPath) {
        const skinFileName = `${username}_${Date.now()}.png`;
        const destinationPath = path.join(skinsDir, skinFileName);
        
        try {
            fs.copyFileSync(selectedSkinPath, destinationPath);
            skinPath = destinationPath;
        } catch (err) {
            console.error('Ошибка копирования скина:', err);
        }
    }
    
    const profile = {
        username,
        version,
        skinPath,
        loaderType: currentVersionType, // Сохраняем тип загрузчика
        created: new Date().toISOString()
    };
    
    profiles.push(profile);
    localStorage.setItem('minecraft-profiles', JSON.stringify(profiles));
    selectedProfileIndex = profiles.length - 1;
    localStorage.setItem('selected-profile-index', selectedProfileIndex);
    
    updateProfilesList();
    closeDialog();
};

window.closeDialog = function() {
    const dialog = document.querySelector('.dialog-overlay');
    if (dialog) {
        const dialogContent = dialog.querySelector('.dialog');
        dialogContent.classList.remove('visible');
        setTimeout(() => {
            dialog.remove();
        }, 300);
    }
};

window.editProfile = async function(index) {
    event.stopPropagation();
    const profile = profiles[index];
    selectedSkinPath = profile.skinPath || '';
    currentVersionType = profile.loaderType || 'vanilla';
    
    const dialog = document.createElement('div');
    dialog.className = 'dialog-overlay';
    dialog.innerHTML = `
        <div class="dialog">
            <h2>Редактировать профиль</h2>
            <div class="dialog-content">
                <div class="input-group">
                    <label>Никнейм:</label>
                    <input type="text" id="edit-profile-username" value="${profile.username}">
                </div>
                <div class="input-group">
                    <label>Версия Minecraft:</label>
                    <select id="edit-profile-version">
                        <option value="">Загрузка версий...</option>
                    </select>
                </div>
                <div class="input-group">
                    <label>Тип загрузчика:</label>
                    <div class="version-buttons">
                        <button id="edit-profile-vanilla" class="version-button ${currentVersionType === 'vanilla' ? 'active' : ''}">Vanilla</button>
                        <button id="edit-profile-fabric" class="version-button ${currentVersionType === 'fabric' ? 'active' : ''}">Fabric</button>
                        <button id="edit-profile-forge" class="version-button ${currentVersionType === 'forge' ? 'active' : ''}">Forge</button>
                    </div>
                </div>
                <div class="input-group">
                    <label>Скин:</label>
                    <div class="skin-selector">
                        <div id="skin-preview" class="skin-preview">
                            ${profile.skinPath 
                                ? `<img src="file://${profile.skinPath}" alt="Скин" class="skin-image">` 
                                : `<div class="no-skin">Без скина</div>`}
                        </div>
                        <div class="skin-buttons">
                            <button onclick="selectSkinFile()">Выбрать файл</button>
                            <button onclick="clearSkinSelection()">Сбросить</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="dialog-buttons">
                <button onclick="saveEditedProfile(${index})">Сохранить</button>
                <button onclick="closeDialog()">Отмена</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
    
    // Добавляем класс visible с небольшой задержкой для анимации
    setTimeout(() => {
        dialog.querySelector('.dialog').classList.add('visible');
    }, 10);
    
    // Загружаем версии
    const versionSelect = document.getElementById('edit-profile-version');
    const versions = await loadMinecraftVersions(versionSelect);
    
    // Выбираем текущую версию профиля
    if (profile.version) {
        const option = versionSelect.querySelector(`option[value="${profile.version}"]`);
        if (option) {
            option.selected = true;
        }
    }
    
    // Настраиваем обработчики для кнопок выбора типа версии
    function setVersionType(type) {
        currentVersionType = type;
        document.querySelectorAll('.dialog .version-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(`edit-profile-${type}`).classList.add('active');
    }
    
    document.getElementById('edit-profile-vanilla').addEventListener('click', () => setVersionType('vanilla'));
    document.getElementById('edit-profile-fabric').addEventListener('click', () => setVersionType('fabric'));
    document.getElementById('edit-profile-forge').addEventListener('click', () => setVersionType('forge'));
};

window.saveEditedProfile = function(index) {
    const username = document.getElementById('edit-profile-username').value;
    const version = document.getElementById('edit-profile-version').value;
    
    if (!username) {
        alert('Введите никнейм!');
        return;
    }
    
    if (!version) {
        alert('Выберите версию!');
        return;
    }
    
    let skinPath = profiles[index].skinPath;
    
    // Если скин изменился
    if (selectedSkinPath !== skinPath) {
        // Если был старый скин, удаляем его
        if (skinPath && fs.existsSync(skinPath)) {
            try {
                fs.unlinkSync(skinPath);
            } catch (err) {
                console.error('Ошибка удаления старого скина:', err);
            }
        }
        
        // Если выбран новый скин, копируем его
        if (selectedSkinPath) {
            const skinFileName = `${username}_${Date.now()}.png`;
            const destinationPath = path.join(skinsDir, skinFileName);
            
            try {
                fs.copyFileSync(selectedSkinPath, destinationPath);
                skinPath = destinationPath;
            } catch (err) {
                console.error('Ошибка копирования скина:', err);
            }
        } else {
            skinPath = ''; // Скин был сброшен
        }
    }
    
    profiles[index] = {
        ...profiles[index],
        username,
        version,
        skinPath,
        loaderType: currentVersionType // Сохраняем тип загрузчика
    };
    
    localStorage.setItem('minecraft-profiles', JSON.stringify(profiles));
    updateProfilesList();
    closeDialog();
};

// Обновляем функцию updateProfilesList чтобы показывать тип загрузчика
function updateProfilesList() {
    const profilesList = document.getElementById('profiles-list');
    profilesList.innerHTML = '';
    
    profiles.forEach((profile, index) => {
        const profileElement = document.createElement('div');
        profileElement.className = 'profile-item' + (index === selectedProfileIndex ? ' selected' : '');
        
        const skinPreview = profile.skinPath 
            ? `<img src="file://${profile.skinPath}" alt="${profile.username}" class="profile-avatar">` 
            : `<img src="https://minotar.net/avatar/${profile.username}" alt="${profile.username}" class="profile-avatar">`;
        
        // Добавляем отображение типа загрузчика
        const loaderType = profile.loaderType || 'vanilla';
        const loaderDisplay = loaderType.charAt(0).toUpperCase() + loaderType.slice(1);
        
        profileElement.innerHTML = `
            ${skinPreview}
            <div class="profile-info">
                <span class="profile-name">${profile.username}</span>
                <span class="profile-version">${profile.version || 'Не выбрана'} (${loaderDisplay})</span>
            </div>
            <div class="profile-controls">
                <button class="edit-profile-btn" data-index="${index}">✎</button>
                <button class="delete-profile-btn" data-index="${index}">×</button>
            </div>
        `;
        
        // Добавляем обработчики событий
        profileElement.querySelector('.edit-profile-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            editProfile(index);
        });
        
        profileElement.querySelector('.delete-profile-btn').addEventListener('click', (e) => {
            deleteProfile(index, e);
        });
        
        profileElement.addEventListener('click', () => selectProfile(index));
        profilesList.appendChild(profileElement);
    });
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    // Загружаем профили из localStorage
    profiles = JSON.parse(localStorage.getItem('minecraft-profiles') || '[]');
    selectedProfileIndex = parseInt(localStorage.getItem('selected-profile-index') || '0');
    
    // Обновляем список профилей
    updateProfilesList();
});

// Обработчики кнопок
document.getElementById('add-profile-button').addEventListener('click', showAddProfileDialog);

// Добавим глобальную переменную для отслеживания состояния запуска
let launchInProgress = false;
let minecraftProcess = null;

document.getElementById('play-button').addEventListener('click', async () => {
    // Предотвращаем повторный запуск, если процесс уже идет
    if (launchInProgress) {
        alert('Запуск Minecraft уже выполняется, пожалуйста, подождите.');
        return;
    }
    
    // Если уже запущен процесс, спрашиваем пользователя, хочет ли он его закрыть
    if (minecraftProcess) {
        if (confirm('Minecraft уже запущен. Хотите закрыть его и запустить снова?')) {
            try {
                // Попытка завершить процесс
                minecraftProcess.kill();
            } catch (err) {
                console.error('Ошибка при закрытии предыдущего процесса:', err);
            }
            minecraftProcess = null;
        } else {
            return; // Пользователь решил не перезапускать
        }
    }
    
    if (profiles.length === 0) {
        alert('Добавьте хотя бы один профиль!');
        return;
    }

    const selectedProfile = profiles[selectedProfileIndex];
    if (!selectedProfile) {
        alert('Выберите профиль!');
        return;
    }

    if (!selectedProfile.version) {
        alert('Выберите версию для профиля!');
        return;
    }
    
    launchInProgress = true;
    toggleProgressBar(true); // Показываем прогресс-бар сразу
    
    // Очищаем предыдущие обработчики событий
    launcher.removeAllListeners('progress');
    launcher.removeAllListeners('download');
    launcher.removeAllListeners('extract');
    launcher.removeAllListeners('debug');
    launcher.removeAllListeners('data');
    launcher.removeAllListeners('close');
    launcher.removeAllListeners('error');
    
    // Определяем путь к временным файлам для возможной очистки
    const tempDir = path.join(settings.gameDir, 'tmp');
    const nativesDir = path.join(settings.gameDir, 'versions', selectedProfile.version, 'natives');
    
    // Проверяем, существуют ли эти директории, и очищаем их при необходимости
    try {
        if (fs.existsSync(tempDir)) {
            console.log('Очистка временных файлов перед запуском...');
            clearTempFiles();
        }
        
        if (fs.existsSync(nativesDir)) {
            console.log('Очистка natives директории перед запуском...');
            deleteFolderRecursive(nativesDir);
        }
    } catch (err) {
        console.error('Ошибка при очистке директорий перед запуском:', err);
    }

    // Определяем настройки загрузчика модов (Forge или Fabric)
    const loaderType = selectedProfile.loaderType || 'vanilla';
    let forge = null;
    let fabricVersion = null;
    
    // Настройки для Forge или Fabric
    if (loaderType === 'forge') {
        forge = '1.19.2-43.2.14'; // Укажите версию Forge по умолчанию
        
        // Здесь можно динамически определить версию Forge в зависимости от версии Minecraft
        const forgeVersions = {
            '1.19.2': '1.19.2-43.2.14',
            '1.18.2': '1.18.2-40.2.0',
            '1.16.5': '1.16.5-36.2.39'
        };
        
        if (forgeVersions[selectedProfile.version]) {
            forge = forgeVersions[selectedProfile.version];
        }
    } else if (loaderType === 'fabric') {
        fabricVersion = {
            loaderVersion: "0.14.22",
            minecraft: selectedProfile.version
        };
    }
    
    // Настройки для запуска
    const opts = {
        clientPackage: null,
        authorization: Authenticator.getAuth(selectedProfile.username),
        root: settings.gameDir,
        version: {
            number: selectedProfile.version,
            type: "release"
        },
        memory: settings.memory,
        javaPath: settings.javaPath || undefined,
        forge: forge,
        fabric: fabricVersion,
        overrides: {
            detached: true,
            gameDirectory: path.join(settings.gameDir),
        },
        timeout: 120000,
        game: {
            directory: path.join(settings.gameDir, 'versions'),
            assets: path.join(settings.gameDir, 'assets')
        }
    };

    try {
        // Улучшенная обработка событий
        launcher.on('debug', (e) => {
            console.log('Debug:', e);
        });
        
        launcher.on('data', (e) => {
            console.log('Data:', e);
        });
        
        launcher.on('progress', (e) => {
            console.log('Progress event:', e);
            updateProgress({
                status: e.type === 'assets' ? 'Загрузка ресурсов...' : 'Загрузка файлов...',
                progress: e.task / e.total
            });
        });

        launcher.on('download', (e) => {
            console.log('Download event:', e);
            updateProgress({
                status: `Загрузка: ${e.name || 'файлы игры'}`,
                progress: e.current / e.total
            });
        });

        launcher.on('extract', (e) => {
            console.log('Extract event:', e);
            updateProgress({
                status: 'Распаковка файлов...',
                progress: e.current / e.total
            });
        });
        
        // Обработчик для процесса
        launcher.on('arguments', (args) => {
            console.log('Launch arguments:', args);
        });
        
        // Добавляем обработчик для дополнительных событий
        launcher.on('close', (code) => {
            console.log('Minecraft closed with code:', code);
            minecraftProcess = null;
            launchInProgress = false;
            // Не скрываем прогресс-бар здесь, это будет делать обработчик process.on('close')
        });
        
        launcher.on('error', (err) => {
            console.error('Error:', err);
            minecraftProcess = null;
            launchInProgress = false;
            toggleProgressBar(false);
            alert(`Ошибка Minecraft: ${err.message}`);
        });

        // Запускаем игру с использованием async/await
        console.log('Launching with options:', JSON.stringify(opts, null, 2));
        const process = await launcher.launch(opts);
        
        // Сохраняем ссылку на процесс
        minecraftProcess = process;
        
        // Показываем сообщение о успешном запуске, но не скрываем прогресс-бар
        updateProgress({
            status: 'Minecraft запущен успешно! Прогресс-бар исчезнет при закрытии игры.',
            progress: 1
        });
        
        // Обработка событий процесса
        process.on('error', (err) => {
            console.error('Process error:', err);
            minecraftProcess = null;
            launchInProgress = false;
            toggleProgressBar(false); // Скрываем прогресс-бар только при ошибке
        });
        
        process.on('close', (code) => {
            console.log('Process closed with code:', code);
            minecraftProcess = null;
            launchInProgress = false;
            toggleProgressBar(false); // Скрываем прогресс-бар когда Minecraft закрывается
        });
        
    } catch (err) {
        console.error('Launch error:', err);
        toggleProgressBar(false);
        launchInProgress = false;
        minecraftProcess = null;
        alert('Ошибка запуска: ' + err.message);
    }
});

// Функция для очистки временных файлов Minecraft
function clearTempFiles() {
    try {
        const tempDir = path.join(settings.gameDir, 'tmp');
        if (fs.existsSync(tempDir)) {
            // Перебираем все файлы в директории и удаляем их
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                try {
                    if (fs.lstatSync(filePath).isDirectory()) {
                        // Удаляем рекурсивно директорию
                        deleteFolderRecursive(filePath);
                    } else {
                        // Удаляем файл
                        fs.unlinkSync(filePath);
                    }
                } catch (err) {
                    console.error(`Ошибка удаления файла ${filePath}:`, err);
                }
            }
            return true;
        }
    } catch (err) {
        console.error('Ошибка очистки временных файлов:', err);
    }
    return false;
}

// Функция для рекурсивного удаления директорий
function deleteFolderRecursive(folderPath) {
    if (fs.existsSync(folderPath)) {
        fs.readdirSync(folderPath).forEach(file => {
            const curPath = path.join(folderPath, file);
            if (fs.lstatSync(curPath).isDirectory()) {
                // Рекурсивно удаляем вложенную директорию
                deleteFolderRecursive(curPath);
            } else {
                // Удаляем файл
                fs.unlinkSync(curPath);
            }
        });
        // Удаляем саму директорию
        fs.rmdirSync(folderPath);
    }
}

// Функция для полного сброса установки Minecraft
function resetMinecraftInstallation() {
    try {
        const importantDirs = [
            path.join(settings.gameDir, 'assets'),
            path.join(settings.gameDir, 'libraries'),
            path.join(settings.gameDir, 'versions'),
            path.join(settings.gameDir, 'tmp')
        ];
        
        let resetCount = 0;
        
        importantDirs.forEach(dir => {
            if (fs.existsSync(dir)) {
                try {
                    console.log(`Удаление директории: ${dir}`);
                    deleteFolderRecursive(dir);
                    resetCount++;
                } catch (err) {
                    console.error(`Ошибка удаления директории ${dir}:`, err);
                }
            }
        });
        
        // Также удаляем файлы конфигурации
        const configFiles = [
            path.join(settings.gameDir, 'launcher_profiles.json'),
            path.join(settings.gameDir, 'launcher_settings.json')
        ];
        
        configFiles.forEach(file => {
            if (fs.existsSync(file)) {
                try {
                    console.log(`Удаление файла: ${file}`);
                    fs.unlinkSync(file);
                    resetCount++;
                } catch (err) {
                    console.error(`Ошибка удаления файла ${file}:`, err);
                }
            }
        });
        
        return resetCount > 0;
    } catch (err) {
        console.error('Ошибка сброса установки Minecraft:', err);
        return false;
    }
}

// Обновляем окно настроек, добавляя кнопку полного сброса
document.getElementById('settings-button').addEventListener('click', () => {
    switchTab('settings-tab');
    loadSettingsToUI(); // Загружаем текущие настройки
});

window.selectGameDir = async function() {
    const folder = await selectFolder();
    if (folder) {
        document.getElementById('game-dir').value = folder;
    }
};

window.saveSettings = function() {
    const newGameDir = document.getElementById('game-dir').value;
    
    if (newGameDir !== settings.gameDir) {
        const newModsDir = path.join(newGameDir, 'mods');
        if (!fs.existsSync(newModsDir)) {
            fs.mkdirSync(newModsDir, { recursive: true });
        }
    }

    settings = {
        memory: {
            min: document.getElementById('min-memory').value,
            max: document.getElementById('max-memory').value
        },
        javaPath: document.getElementById('java-path').value,
        gameDir: newGameDir
    };
    
    localStorage.setItem('launcher-settings', JSON.stringify(settings));
    closeDialog();
};

// Обработчик для кнопки очистки временных файлов
window.clearTemp = function() {
    if (clearTempFiles()) {
        alert('Временные файлы успешно очищены!');
    } else {
        alert('Не удалось найти или очистить временные файлы.');
    }
};

// Обработчик для кнопки полного сброса Minecraft
window.resetMinecraft = function() {
    if (confirm('ВНИМАНИЕ! Эта операция удалит все файлы Minecraft и потребует повторной загрузки игры. Продолжить?')) {
        if (resetMinecraftInstallation()) {
            alert('Minecraft успешно сброшен! При следующем запуске игра будет загружена заново.');
        } else {
            alert('Не удалось выполнить полный сброс Minecraft.');
        }
    }
};

// Социальные сети
document.querySelector('img[alt="Telegram"]')?.addEventListener('click', () => {
    require('electron').shell.openExternal('https://t.me/novadev_hub');
});

// Инициализация
updateProfilesList();

// Функция для переключения между вкладками
function switchTab(tabId) {
    document.querySelectorAll('.content-page').forEach(tab => {
        tab.classList.remove('active');
    });
    
    const activeTab = document.getElementById(tabId);
    if (activeTab) {
        activeTab.classList.add('active');
    }
}

// Функция для показа/скрытия прогресс-бара
function toggleProgressBar(show) {
    const progressContainer = document.getElementById('progress-container');
    if (!progressContainer) return;
    
    if (show) {
        progressContainer.style.display = 'block';
        // Добавляем небольшую задержку перед добавлением класса для анимации
        setTimeout(() => {
            progressContainer.classList.add('visible');
        }, 10);
    } else {
        progressContainer.classList.remove('visible');
        // Добавляем задержку перед скрытием, чтобы анимация успела завершиться
        setTimeout(() => {
            progressContainer.style.display = 'none';
        }, 300);
    }
}

// Функция для показа/скрытия модальных окон
function toggleModal(modalId, show) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    
    if (show) {
        modal.style.display = 'block';
        setTimeout(() => {
            modal.classList.add('visible');
        }, 10);
    } else {
        modal.classList.remove('visible');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
}

// Обработчики для закрытия модальных окон
document.querySelectorAll('.close-button').forEach(button => {
    button.addEventListener('click', () => {
        const modal = button.closest('.settings-window');
        if (modal) {
            toggleModal(modal.id, false);
        }
    });
});

// Анимация при наведении на профили
document.querySelectorAll('.profile-item').forEach(item => {
    item.addEventListener('mouseenter', () => {
        item.style.transform = 'translateX(5px)';
    });
    
    item.addEventListener('mouseleave', () => {
        item.style.transform = 'translateX(0)';
    });
});

// Функции для работы с профилями
function selectProfile(index) {
    selectedProfileIndex = index;
    localStorage.setItem('selected-profile-index', index);
    updateProfilesList();
}

function deleteProfile(index, event) {
    if (event) {
        event.stopPropagation();
    }
    if (confirm('Вы уверены, что хотите удалить этот профиль?')) {
        // Удаляем файл скина, если он есть
        const profile = profiles[index];
        if (profile.skinPath && fs.existsSync(profile.skinPath)) {
            try {
                fs.unlinkSync(profile.skinPath);
            } catch (err) {
                console.error('Ошибка удаления файла скина:', err);
            }
        }
        
        profiles.splice(index, 1);
        if (selectedProfileIndex >= profiles.length) {
            selectedProfileIndex = profiles.length - 1;
        }
        if (selectedProfileIndex < 0) {
            selectedProfileIndex = 0;
        }
        localStorage.setItem('minecraft-profiles', JSON.stringify(profiles));
        localStorage.setItem('selected-profile-index', selectedProfileIndex);
        updateProfilesList();
    }
}

window.selectSkinFile = async function() {
    const skinPath = await selectFile({
        title: 'Выберите файл скина',
        filters: [
            { name: 'Изображения', extensions: ['png'] }
        ]
    });
    
    if (skinPath) {
        selectedSkinPath = skinPath;
        const skinPreview = document.getElementById('skin-preview');
        skinPreview.innerHTML = `<img src="file://${skinPath}" alt="Скин" class="skin-image">`;
    }
};

window.clearSkinSelection = function() {
    selectedSkinPath = '';
    const skinPreview = document.getElementById('skin-preview');
    skinPreview.innerHTML = `<div class="no-skin">Без скина</div>`;
};

// Экспортируем функции в глобальную область видимости
window.selectProfile = selectProfile;
window.deleteProfile = deleteProfile;
window.editProfile = editProfile;

document.addEventListener('change', (event) => {
    // Обработка других событий изменения
});

// Функции управления темами
const themes = {
    winter: {
        background: './assets/background.jpg',
        buttonColor: '#4CAF50',
        secondaryColor: '#2196F3',
        accentColor: '#9C27B0'
    },
    blossom: {
        background: './assets/blossom.png',
        buttonColor: '#FF69B4',
        secondaryColor: '#FF1493',
        accentColor: '#C71585'
    },
    swap: {
        background: './assets/swamp.png',
        buttonColor: '#2E7D32',
        secondaryColor: '#1B5E20',
        accentColor: '#388E3C'
    }
};

function changeTheme(themeName) {
    // Удаляем все классы тем
    document.body.classList.remove('theme-winter', 'theme-blossom', 'theme-swap');
    
    // Добавляем класс выбранной темы
    document.body.classList.add(`theme-${themeName}`);
    
    // Меняем фоновое изображение
    document.body.style.backgroundImage = `url(${themes[themeName].background})`;
    
    // Обновляем цвета кнопок
    document.documentElement.style.setProperty('--primary-color', themes[themeName].buttonColor);
    document.documentElement.style.setProperty('--secondary-color', themes[themeName].secondaryColor);
    document.documentElement.style.setProperty('--accent-color', themes[themeName].accentColor);
    
    // Обновляем активную кнопку
    document.querySelectorAll('.theme-button').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeButton = document.querySelector(`.theme-button[data-theme="${themeName}"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }
    
    // Сохраняем выбранную тему в localStorage
    localStorage.setItem('selectedTheme', themeName);
}

// Загружаем сохраненную тему при запуске
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('selectedTheme') || 'winter';
    changeTheme(savedTheme);
});

// Расширенные настройки лаунчера
const defaultLauncherSettings = {
    appearance: {
        theme: 'winter',
        uiOpacity: 70,
        fontSize: 'medium'
    },
    launch: {
        autoLaunch: false,
        minimizeOnLaunch: true,
        closeOnLaunch: false
    },
    minecraft: {
        memory: {
            min: "2G",
            max: "4G"
        },
        javaPath: "",
        gameDir: path.join(__dirname, 'minecraft')
    }
};

// Загрузка настроек лаунчера
let launcherSettings = JSON.parse(localStorage.getItem('launcher-settings') || JSON.stringify(defaultLauncherSettings));

// Функция для сохранения настроек
function saveLauncherSettings() {
    localStorage.setItem('launcher-settings', JSON.stringify(launcherSettings));
}

// Функция для применения настроек внешнего вида
function applyAppearanceSettings() {
    // Применяем тему
    changeTheme(launcherSettings.appearance.theme);
    
    // Применяем прозрачность
    document.documentElement.style.setProperty('--background-dark', `rgba(0, 0, 0, ${launcherSettings.appearance.uiOpacity / 100})`);
    
    // Применяем размер шрифта
    const fontSizes = {
        small: '14px',
        medium: '16px',
        large: '18px'
    };
    document.documentElement.style.setProperty('--base-font-size', fontSizes[launcherSettings.appearance.fontSize]);
}

// Обработчик изменения прозрачности
document.getElementById('ui-opacity').addEventListener('input', (e) => {
    const value = e.target.value;
    document.querySelector('.range-value').textContent = value + '%';
    launcherSettings.appearance.uiOpacity = parseInt(value);
    applyAppearanceSettings();
});

// Обработчик изменения размера шрифта
document.getElementById('font-size').addEventListener('change', (e) => {
    launcherSettings.appearance.fontSize = e.target.value;
    applyAppearanceSettings();
});

// Обработчики для переключателей в настройках запуска
document.getElementById('auto-launch').addEventListener('change', (e) => {
    launcherSettings.launch.autoLaunch = e.target.checked;
});

document.getElementById('minimize-on-launch').addEventListener('change', (e) => {
    launcherSettings.launch.minimizeOnLaunch = e.target.checked;
});

document.getElementById('close-on-launch').addEventListener('change', (e) => {
    launcherSettings.launch.closeOnLaunch = e.target.checked;
});

// Функция для выбора пути к Java
window.selectJavaPath = async function() {
    const javaPath = await selectFile({
        title: 'Выберите исполняемый файл Java',
        filters: [
            { name: 'Исполняемые файлы', extensions: ['exe'] }
        ]
    });
    
    if (javaPath) {
        document.getElementById('java-path').value = javaPath;
        launcherSettings.minecraft.javaPath = javaPath;
    }
};

// Обновляем функцию сохранения настроек
window.saveSettings = function() {
    // Сохраняем настройки памяти
    launcherSettings.minecraft.memory = {
        min: document.getElementById('min-memory').value,
        max: document.getElementById('max-memory').value
    };
    
    // Сохраняем путь к игре
    launcherSettings.minecraft.gameDir = document.getElementById('game-dir').value;
    
    // Сохраняем все настройки
    saveLauncherSettings();
    
    // Применяем настройки
    applyAppearanceSettings();
    
    // Закрываем окно настроек
    toggleModal('settings-window', false);
};

// Функция очистки кэша лаунчера
window.clearCache = function() {
    try {
        const cacheDir = path.join(__dirname, 'cache');
        if (fs.existsSync(cacheDir)) {
            fs.rmdirSync(cacheDir, { recursive: true });
            alert('Кэш лаунчера успешно очищен!');
        }
    } catch (err) {
        console.error('Ошибка при очистке кэша:', err);
        alert('Ошибка при очистке кэша лаунчера');
    }
};

// Обновляем функцию загрузки настроек при открытии окна
function loadSettingsToUI() {
    // Загружаем настройки внешнего вида
    document.getElementById('ui-opacity').value = launcherSettings.appearance.uiOpacity;
    document.querySelector('.range-value').textContent = launcherSettings.appearance.uiOpacity + '%';
    document.getElementById('font-size').value = launcherSettings.appearance.fontSize;
    
    // Загружаем настройки запуска
    document.getElementById('auto-launch').checked = launcherSettings.launch.autoLaunch;
    document.getElementById('minimize-on-launch').checked = launcherSettings.launch.minimizeOnLaunch;
    document.getElementById('close-on-launch').checked = launcherSettings.launch.closeOnLaunch;
    
    // Загружаем настройки Minecraft
    document.getElementById('min-memory').value = launcherSettings.minecraft.memory.min;
    document.getElementById('max-memory').value = launcherSettings.minecraft.memory.max;
    document.getElementById('game-dir').value = launcherSettings.minecraft.gameDir;
    document.getElementById('java-path').value = launcherSettings.minecraft.javaPath;
    
    // Отмечаем активную тему
    document.querySelectorAll('.theme-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === launcherSettings.appearance.theme);
    });
}

// Обработчик для кнопок выбора темы в настройках
document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        launcherSettings.appearance.theme = theme;
        changeTheme(theme);
        
        // Обновляем активную кнопку
        document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// Обновляем обработчик открытия окна настроек
document.getElementById('settings-button').addEventListener('click', () => {
    switchTab('settings-tab');
    loadSettingsToUI();
});

// Применяем настройки при запуске
document.addEventListener('DOMContentLoaded', () => {
    loadSettingsToUI();
    applyAppearanceSettings();
});

// Обновляем функцию запуска игры с учетом новых настроек
document.getElementById('play-button').addEventListener('click', async () => {
    // ... existing launch code ...
    
    if (launcherSettings.launch.minimizeOnLaunch) {
        ipcRenderer.send('minimize-window');
    }
    
    if (launcherSettings.launch.closeOnLaunch) {
        ipcRenderer.send('close-window');
    }
});

// Обновляем функцию применения настроек
function applySettings() {
    // Применяем настройки Minecraft
    settings = {
        memory: {
            min: launcherSettings.minecraft.memory.min,
            max: launcherSettings.minecraft.memory.max
        },
        javaPath: launcherSettings.minecraft.javaPath,
        gameDir: launcherSettings.minecraft.gameDir
    };

    // Применяем размер шрифта
    const fontSizes = {
        small: '14px',
        medium: '16px',
        large: '18px'
    };
    document.documentElement.style.setProperty('--base-font-size', fontSizes[launcherSettings.appearance.fontSize]);
    document.body.style.fontSize = fontSizes[launcherSettings.appearance.fontSize];
    
    // Сохраняем настройки
    localStorage.setItem('launcher-settings', JSON.stringify(launcherSettings));
    localStorage.setItem('settings', JSON.stringify(settings));
}

// Обновляем обработчики изменений настроек
document.getElementById('font-size').addEventListener('change', (e) => {
    launcherSettings.appearance.fontSize = e.target.value;
    applySettings();
});

document.getElementById('auto-launch').addEventListener('change', (e) => {
    launcherSettings.launch.autoLaunch = e.target.checked;
    applySettings();
});

document.getElementById('minimize-on-launch').addEventListener('change', (e) => {
    launcherSettings.launch.minimizeOnLaunch = e.target.checked;
    applySettings();
});

document.getElementById('close-on-launch').addEventListener('change', (e) => {
    launcherSettings.launch.closeOnLaunch = e.target.checked;
    applySettings();
});

// Обработчики изменения памяти
document.getElementById('min-memory').addEventListener('change', (e) => {
    launcherSettings.minecraft.memory.min = e.target.value;
    applySettings();
});

document.getElementById('max-memory').addEventListener('change', (e) => {
    launcherSettings.minecraft.memory.max = e.target.value;
    applySettings();
});

// Обработчик изменения пути к Java
window.selectJavaPath = async function() {
    const javaPath = await selectFile({
        title: 'Выберите исполняемый файл Java',
        filters: [
            { name: 'Исполняемые файлы', extensions: ['exe'] }
        ]
    });
    
    if (javaPath) {
        document.getElementById('java-path').value = javaPath;
        launcherSettings.minecraft.javaPath = javaPath;
        applySettings();
    }
};

// Обработчик изменения директории игры
window.selectGameDir = async function() {
    const gameDir = await selectFolder();
    if (gameDir) {
        document.getElementById('game-dir').value = gameDir;
        launcherSettings.minecraft.gameDir = gameDir;
        applySettings();
    }
};

// Обновляем функцию загрузки настроек в интерфейс
function loadSettingsToUI() {
    // Загружаем настройки запуска
    document.getElementById('auto-launch').checked = launcherSettings.launch.autoLaunch;
    document.getElementById('minimize-on-launch').checked = launcherSettings.launch.minimizeOnLaunch;
    document.getElementById('close-on-launch').checked = launcherSettings.launch.closeOnLaunch;
    
    // Загружаем настройки внешнего вида
    document.getElementById('font-size').value = launcherSettings.appearance.fontSize;
    
    // Загружаем настройки Minecraft
    document.getElementById('min-memory').value = launcherSettings.minecraft.memory.min;
    document.getElementById('max-memory').value = launcherSettings.minecraft.memory.max;
    document.getElementById('game-dir').value = launcherSettings.minecraft.gameDir;
    document.getElementById('java-path').value = launcherSettings.minecraft.javaPath;
}

// Обновляем функцию запуска игры
document.getElementById('play-button').addEventListener('click', async () => {
    if (launcherSettings.launch.minimizeOnLaunch) {
        ipcRenderer.send('minimize-window');
    }
    
    if (launcherSettings.launch.closeOnLaunch) {
        ipcRenderer.send('close-window');
        return;
    }
    
    // ... остальной код запуска игры ...
});

// Применяем настройки при запуске
document.addEventListener('DOMContentLoaded', () => {
    loadSettingsToUI();
    applySettings();
});

// Функция закрытия настроек
window.closeSettings = function() {
    switchTab('play-tab');
};