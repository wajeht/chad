const FIELDS = ['apiKey', 'model', 'customPrompt'];

document.addEventListener('DOMContentLoaded', async () => {
    const settings = await chrome.storage.sync.get(FIELDS);
    FIELDS.forEach(field => {
        const element = document.getElementById(field);
        if (settings[field] !== undefined) {
            if (element.type === 'checkbox') {
                element.checked = settings[field];
            } else {
                element.value = settings[field];
            }
        }
    });

    await displayDomainSelectors();
});

document.getElementById('saveSettings').addEventListener('click', async () => {
    const settings = {};
    FIELDS.forEach(field => {
        const element = document.getElementById(field);
        settings[field] = element.type === 'checkbox' ? element.checked : element.value.trim();
    });

    if (!settings.apiKey || !settings.model) {
        alert('API Key and Model are required');
        return;
    }

    await chrome.storage.sync.set(settings);
    alert('Settings saved!');

});

document.addEventListener('DOMContentLoaded', () => {
    const apiKeyToggle = document.getElementById('apiKeyToggle');
    const apiKeyInput = document.getElementById('apiKey');

    apiKeyToggle.addEventListener('click', function () {
        const isPassword = apiKeyInput.type === 'password';
        apiKeyInput.type = isPassword ? 'text' : 'password';
        this.textContent = isPassword ? '(hide)' : '(show)';
    });
});

document.getElementById('toggleSelector').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const button = document.getElementById('toggleSelector');

    if (button.textContent === 'Enable Element Selector') {
        button.textContent = 'Disable Element Selector';
        await chrome.tabs.sendMessage(tab.id, { action: 'enableSelector' });
    } else {
        button.textContent = 'Enable Element Selector';
        await chrome.tabs.sendMessage(tab.id, { action: 'disableSelector' });
    }
});

function simplifyUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.pathname + urlObj.search;
    } catch (e) {
        return url;
    }
}

async function displayDomainSelectors() {
    const container = document.getElementById('domainSelectors');
    if (!container) return;

    const { domainSelectors = {} } = await chrome.storage.sync.get('domainSelectors');

    container.innerHTML = '';

    if (Object.keys(domainSelectors).length === 0) {
        container.innerHTML = '<div class="no-selectors">No saved elements</div>';
        return;
    }

    for (const [domain, selectors] of Object.entries(domainSelectors)) {
        const domainGroup = document.createElement('div');
        domainGroup.className = 'domain-group';

        const domainName = document.createElement('div');
        domainName.className = 'domain-name';
        domainName.textContent = domain;
        domainGroup.appendChild(domainName);

        selectors.forEach((selectorData, index) => {
            const selectorItem = document.createElement('div');
            selectorItem.className = 'selector-item';

            const selectorInfo = document.createElement('div');
            selectorInfo.className = 'selector-info';

            const selectorText = document.createElement('div');
            selectorText.className = 'selector-text';
            selectorText.textContent = typeof selectorData === 'string' ? selectorData : selectorData.selector;

            const urlText = document.createElement('div');
            urlText.className = 'url-text';
            const url = typeof selectorData === 'string' ? '' : selectorData.url;
            urlText.textContent = simplifyUrl(url);
            urlText.title = url; // Show full URL on hover

            selectorInfo.appendChild(selectorText);
            selectorInfo.appendChild(urlText);

            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-selector';
            deleteButton.textContent = '×';
            deleteButton.onclick = async () => {
                await deleteSelector(domain, index);
                await displayDomainSelectors();
            };

            selectorItem.appendChild(selectorInfo);
            selectorItem.appendChild(deleteButton);
            domainGroup.appendChild(selectorItem);
        });

        container.appendChild(domainGroup);
    }
}

async function deleteSelector(domain, index) {
    const { domainSelectors = {} } = await chrome.storage.sync.get('domainSelectors');

    if (domainSelectors[domain]) {
        domainSelectors[domain].splice(index, 1);

        if (domainSelectors[domain].length === 0) {
            delete domainSelectors[domain];
        }

        await chrome.storage.sync.set({ domainSelectors });

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, {
                action: 'refreshSelectors',
                domainSelectors
            });
        }
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refreshPopup') {
        displayDomainSelectors();
    }
    if (request.action === 'updateToggleButton') {
        const button = document.getElementById('toggleSelector');
        if (button) {
            button.textContent = 'Enable Element Selector';
        }
    }
});
