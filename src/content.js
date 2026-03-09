let cachedSettings = null;
let selectorMode = false;
let highlightedElement = null;
const inputTypes = ['text', 'textarea', 'email', 'password', 'number', 'tel', 'url', 'search', 'color', 'date', 'time', 'datetime-local', 'week', 'month', 'datetime'];

function setupMutationObserver() {
    let cleanupTimeout;
    let isProcessing = false;

    const observer = new MutationObserver(async (mutationsList) => {
        // Skip if we're already processing
        if (isProcessing) return;

        // Check if mutations are relevant
        const hasRelevantChanges = mutationsList.some(mutation => {
            // Skip style changes and chad-button mutations
            if (mutation.target.hasAttribute('data-chad-button')) return false;
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') return false;
            return true;
        });

        if (!hasRelevantChanges) return;

        clearTimeout(cleanupTimeout);
        cleanupTimeout = setTimeout(async () => {
            isProcessing = true;
            try {
                await restoreSavedSelectors();
            } finally {
                isProcessing = false;
            }
        }, 500); // Increased debounce time
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false, // Don't observe attribute changes
        characterData: false
    });

    return observer;
}

function setupStorageListener() {
    chrome.storage.onChanged.addListener(async (changes) => {
        cachedSettings = null;
        if (changes.domainSelectors) {
            await restoreSavedSelectors();
        }
    });
}

function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

async function createButton(element) {
    if (element.getAttribute('data-chad-id')) return;

    const textareaId = `chad-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    element.setAttribute('data-chad-id', textareaId);
    element.setAttribute('data-chad-manual', 'true');

    const button = document.createElement('button');
    button.textContent = '🗿';
    button.setAttribute('data-chad-button', 'true');
    button.setAttribute('data-textarea-id', textareaId);
    button.style.cssText = `
        position: absolute;
        background: white;
        border: solid 1px lightgrey;
        color: white;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 12px;
        z-index: 10000;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;

    const updatePosition = debounce(() => {
        if (!document.body.contains(element)) {
            button.remove();
            return;
        }
        const rect = element.getBoundingClientRect();
        button.style.top = `${rect.bottom - 30 + window.scrollY}px`;
        button.style.left = `${rect.right - 30 + window.scrollX}px`;
    }, 100);

    button.addEventListener('click', () => {
        const text = element.value || element.textContent;
        handleButtonClick(element, button, text);
    });

    document.body.appendChild(button);
    updatePosition();

    window.addEventListener('scroll', updatePosition);
    window.addEventListener('resize', updatePosition);

    new MutationObserver((mutations, observer) => {
        if (!document.body.contains(element)) {
            button.remove();
            observer.disconnect();
            window.removeEventListener('scroll', updatePosition);
            window.removeEventListener('resize', updatePosition);
        }
    }).observe(document.body, { childList: true, subtree: true });
}

async function handleButtonClick(element, button, originalText) {
    button.disabled = true;
    button.textContent = '⏳';

    try {
        const settings = await getSettings();
        if (!settings.apiKey || !settings.model) {
            alert('Please configure your API key and model in the extension popup.');
            return;
        }

        // Get the selector-specific prompt if it exists
        const domain = window.location.hostname;
        const selector = generateUniqueSelector(element);
        const selectorData = settings.domainSelectors[domain]?.find(
            item => item.selector === selector
        );

        const customPrompt = selectorData?.customPrompt || '';
        const prompt = preparePrompt(customPrompt, originalText);

        const response = await fetchChatCompletion(settings.apiKey, settings.model, prompt);
        await streamResponseToTextarea(response, element);
    } catch (error) {
        console.error('Error:', error);
        alert('Error making API request: ' + error.message);
        if (element.value !== undefined) {
            element.value = originalText;
        } else {
            element.textContent = originalText;
        }
    } finally {
        button.disabled = false;
        button.textContent = '🗿';
    }
}

function preparePrompt(customPrompt, originalText) {
    if (!customPrompt) {
        return originalText;
    }

    return `${customPrompt}\n\n${originalText}`;
}

async function getSettings() {
    if (cachedSettings) return cachedSettings;

    const defaults = {
        domainSelectors: {}
    };

    cachedSettings = await chrome.storage.sync.get(['apiKey', 'model', 'domainSelectors']);
    cachedSettings = { ...defaults, ...cachedSettings };

    return cachedSettings;
}

async function fetchChatCompletion(apiKey, model, prompt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
        }),
    });

    if (!response.ok) {
        throw new Error('API request failed');
    }

    return response;
}

async function streamResponseToTextarea(response, element) {
    const originalText = element.value || element.textContent;
    let buffer = '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const newContent = processChunk(chunk);
            if (newContent) {
                buffer += newContent;
                if (element.value !== undefined) {
                    element.value = buffer;
                } else {
                    element.textContent = buffer;
                }
                element.scrollTop = element.scrollHeight;
            }
        }
    } catch (error) {
        console.error('Error streaming response:', error);
        if (element.value !== undefined) {
            element.value = originalText;
        } else {
            element.textContent = originalText;
        }
        throw error;
    }
}

function processChunk(chunk) {
    const lines = chunk.split('\n').filter((line) => line.trim() !== '');

    let content = '';
    for (const line of lines) {
        if (line === 'data: [DONE]') continue;
        if (!line.startsWith('data: ')) continue;

        try {
            const jsonData = JSON.parse(line.replace('data: ', ''));
            const deltaContent = jsonData.choices?.[0]?.delta?.content;
            if (deltaContent) {
                content += deltaContent;
            }
        } catch (error) {
            console.error('Error parsing JSON from chunk:', error);
            continue;
        }
    }

    return content;
}

async function createOverlays() {
    document.querySelectorAll('button[data-chad-button]').forEach(button => {
        const textareaId = button.getAttribute('data-textarea-id');
        if (textareaId && !document.querySelector(`[data-chad-id="${textareaId}"]`)) {
            button.remove();
        }
    });
}

function enableSelectorMode() {
    selectorMode = true;
    document.body.style.cursor = 'crosshair';

    if (highlightedElement) {
        highlightedElement.style.outline = '';
    }

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    document.addEventListener('click', handleSelectorClick);
    document.addEventListener('click', handleClickOff, true);
}

function disableSelectorMode() {
    selectorMode = false;
    document.body.style.cursor = '';

    if (highlightedElement) {
        highlightedElement.style.outline = '';
        highlightedElement = null;
    }

    document.removeEventListener('mouseover', handleMouseOver);
    document.removeEventListener('mouseout', handleMouseOut);
    document.removeEventListener('click', handleSelectorClick);
    document.removeEventListener('click', handleClickOff, true);
}

function handleMouseOver(e) {
    if (!selectorMode) return;
    e.preventDefault();
    e.stopPropagation();

    if (highlightedElement) {
        highlightedElement.style.outline = '';
    }

    highlightedElement = e.target;
    const tagName = e.target.tagName.toLowerCase();
    const isInput = tagName === 'input';
    const isValidType = isInput ? inputTypes.includes(e.target.type) : inputTypes.includes(tagName);
    const hasBubble = highlightedElement.hasAttribute('data-chad-id');

    const isSelectable = isValidType && !hasBubble;
    highlightedElement.style.outline = isSelectable ? '2px solid #4285f4' : '2px solid #ff0000';
    document.body.style.cursor = isSelectable ? 'crosshair' : 'not-allowed';
}

function handleMouseOut(e) {
    if (!selectorMode || !highlightedElement) return;
    highlightedElement.style.outline = '';
}

async function handleSelectorClick(e) {
    if (!selectorMode) return;
    e.preventDefault();
    e.stopPropagation();

    const tagName = e.target.tagName.toLowerCase();
    const isInput = tagName === 'input';
    const isValidType = isInput ? inputTypes.includes(e.target.type) : inputTypes.includes(tagName);
    const hasBubble = e.target.hasAttribute('data-chad-id');

    if (!isValidType || hasBubble) {
        disableSelectorMode();
        alert('Invalid input type or already has bubble');
        return;
    }

    const element = e.target;
    await saveDomainSelector(element);
    createButton(element);

    chrome.runtime.sendMessage({ action: 'refreshPopup' });

    disableSelectorMode();

    chrome.runtime.sendMessage({ action: 'updateToggleButton' });

    const settings = await getSettings();
    await chrome.storage.sync.set(settings);
}

function handleClickOff(e) {
    if (!selectorMode) return;

    if (e.target === document.body || e.target === document) {
        e.preventDefault();
        e.stopPropagation();
        disableSelectorMode();

        chrome.runtime.sendMessage({ action: 'updateToggleButton' });
    }
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'enableSelector') {
        enableSelectorMode();
    } else if (request.action === 'disableSelector') {
        disableSelectorMode();
    } else if (request.action === 'refreshSelectors') {
        removeAllBubbles();
        await restoreSavedSelectors();
    }
});

function removeAllBubbles() {
    document.querySelectorAll('button[data-chad-button]').forEach(button => button.remove());

    document.querySelectorAll('[data-chad-id]').forEach(element => {
        element.removeAttribute('data-chad-id');
        element.removeAttribute('data-chad-manual');
    });
}

function generateUniqueSelector(element) {
    // Try ID first (if it's a valid ID)
    if (element.id && /^[a-zA-Z0-9_-]+$/.test(element.id)) {
        return `#${element.id}`;
    }

    // Try for unique attributes in order of preference
    const uniqueAttrs = [
        'name',
        'data-testid',
        'aria-label',
        'placeholder',
        'role'
    ];

    for (const attr of uniqueAttrs) {
        const value = element.getAttribute(attr);
        if (value && value.trim()) {
            // Clean the value to ensure it's a valid selector
            const cleanValue = value.replace(/"/g, '\\"');
            return `${element.tagName.toLowerCase()}[${attr}="${cleanValue}"]`;
        }
    }

    // For textareas and inputs, create a more specific selector
    if (element.tagName.toLowerCase() === 'textarea' || element.tagName.toLowerCase() === 'input') {
        let selector = element.tagName.toLowerCase();

        // Add type for inputs
        if (element.type) {
            selector += `[type="${element.type}"]`;
        }

        // Add class names that look stable (avoid dynamic classes)
        const stableClasses = Array.from(element.classList)
            .filter(className =>
                !className.includes('--') && // Avoid BEM modifiers
                !/[0-9]/.test(className) && // Avoid classes with numbers
                !className.includes('rgh-') && // Avoid dynamic classes
                className.length > 2 // Avoid very short class names
            )
            .slice(0, 2); // Take only first two stable classes

        if (stableClasses.length > 0) {
            selector += '.' + stableClasses.join('.');
        }

        return selector;
    }

    // Fallback to position-based selector
    let selector = element.tagName.toLowerCase();
    let parent = element.parentElement;
    let index = 0;

    while (parent && index < 3) {
        const siblings = Array.from(parent.children);
        const elementIndex = siblings.indexOf(element) + 1;
        selector = `${parent.tagName.toLowerCase()} > ${selector}:nth-child(${elementIndex})`;
        element = parent;
        parent = element.parentElement;
        index++;
    }

    return selector;
}

async function saveDomainSelector(element) {
    const settings = await getSettings();
    const domain = window.location.hostname;
    const fullUrl = window.location.href;

    const selector = generateUniqueSelector(element);

    if (!settings.domainSelectors[domain]) {
        settings.domainSelectors[domain] = [];
    }

    const selectorData = {
        selector: selector,
        url: fullUrl
    };

    const exists = settings.domainSelectors[domain].some(
        item => item.selector === selector && item.url === fullUrl
    );

    if (!exists) {
        settings.domainSelectors[domain].push(selectorData);
        await chrome.storage.sync.set({ domainSelectors: settings.domainSelectors });
        cachedSettings = null;
    }
}

async function restoreSavedSelectors() {
    try {
        const settings = await getSettings();
        const domain = window.location.hostname;

        // Skip if no selectors for this domain
        if (!settings.domainSelectors?.[domain]) {
            return;
        }

        // Get all existing chad buttons
        const existingButtons = document.querySelectorAll('button[data-chad-button]');
        const existingButtonIds = new Set(
            Array.from(existingButtons).map(button =>
                button.getAttribute('data-textarea-id')
            )
        );

        for (const selectorData of settings.domainSelectors[domain]) {
            try {
                const selector = typeof selectorData === 'string' ? selectorData : selectorData.selector;
                const element = document.querySelector(selector);

                if (element) {
                    const existingId = element.getAttribute('data-chad-id');
                    if (!existingId || !existingButtonIds.has(existingId)) {
                        await createButton(element);
                    }
                }
            } catch (error) {
                console.debug('Invalid selector:', selectorData);
            }
        }
    } catch (error) {
        console.error('Error in restoreSavedSelectors:', error);
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

        // Send message to content script to remove the button
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
            chrome.tabs.sendMessage(tab.id, {
                action: 'refreshSelectors',
                domainSelectors
            });
        }
    }
}

async function initializePage() {
    await restoreSavedSelectors();
    setupStorageListener();
    setupMutationObserver();
}

async function main() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', async () => {
            await initializePage();
        });
    } else {
        await initializePage();
    }
}

main();
