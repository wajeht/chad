const FIELDS = ['apiKey', 'model', 'ignoredUrls', 'customPrompt'];

document.addEventListener('DOMContentLoaded', async () => {
    const settings = await chrome.storage.sync.get(FIELDS);
    FIELDS.forEach(field => {
        if (settings[field]) {
            document.getElementById(field).value = settings[field];
        }
    });
});

document.getElementById('saveSettings').addEventListener('click', async () => {
    const settings = {};
    FIELDS.forEach(field => {
        settings[field] = document.getElementById(field).value.trim();
    });

    if (!settings.apiKey || !settings.model) {
        alert('API Key and Model are required');
        return;
    }

    await chrome.storage.sync.set(settings);
    alert('Settings saved!');
});
