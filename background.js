chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_INIT_STATE") {
        if (sender.tab && sender.tab.id) {
            const tabId = sender.tab.id;
            chrome.storage.local.get([`peq_state_${tabId}`], (result) => {
                sendResponse({ tabId: tabId, state: result[`peq_state_${tabId}`] || null });
            });
            return true; // Keep message channel open for async response
        }
    }
});
