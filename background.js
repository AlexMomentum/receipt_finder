/* global chrome */

let accessToken = null;

/**
 * Known receipt senders (make this global so both `isLikelyReceipt` 
 * and `analyzeMessageContent` can see it).
 */
const receiptSenders = [
  /@amazon\./i,
  /@paypal\./i,
  /@uber\./i,
  /@doordash\./i,
  /@grubhub\./i,
  /payment@/i,
  /receipt@/i,
  /order@/i,
  /invoice@/i,
  /@native-instruments\./i,
  /@mrbill\./i,
  /@soundcloud\./i,
  /@kilohearts\./i,
  /@zoom\./i,
  /@ableton\./i,
  /@splice\./i,
  /@waves\./i,
  /@izotope\./i,
  /@pluginalliance\./i,
  /@arturia\./i,
  /@sweetwater\./i,
  /@reverb\./i,
  /@bandcamp\./i,
  /subscription/i,
  /billing@/i,
  /licenses@/i,
  /licensing@/i
];

class TextAnalyzer {
    constructor() {
        this.documentFrequencies = new Map();
        this.totalDocuments = 0;
        this.receiptWords = new Set([
            'total', 'subtotal', 'tax', 'payment', 'paid', 'amount',
            'invoice', 'receipt', 'order', 'purchase', 'transaction',
            'confirmation', 'authorized', 'charged', 'billing',
            'license', 'activation', 'subscription', 'renewal'
        ]);
    }

    analyzeText(text) {
        const words = text.toLowerCase().split(/\W+/);
        const wordFreq = new Map();
        
        for (const word of words) {
            if (word.length < 2) continue;
            wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
        }

        let receiptScore = 0;
        for (const [word, freq] of wordFreq.entries()) {
            if (this.receiptWords.has(word)) {
                receiptScore += freq;
            }
        }

        return receiptScore / words.length;
    }
}

// Create a global instance
const textAnalyzer = new TextAnalyzer();
// Get or refresh our Auth Token
async function getAuthToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, async (token) => {
      if (chrome.runtime.lastError) {
        console.error("Auth Token Error:", chrome.runtime.lastError);
        return reject(chrome.runtime.lastError);
      }
      if (!token) {
        console.error("No token received");
        return reject(new Error("No token received"));
      }

      // Test token validity
      const testResponse = await fetch(
        `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`
      );
      if (!testResponse.ok) {
        console.warn("Token invalid, removing...");
        chrome.identity.removeCachedAuthToken({ token }, () => {});
        return reject(new Error("Invalid token"));
      }

      accessToken = token;
      console.log("Got auth token:", token);
      resolve(token);
    });
  });
}

// Search Gmail for threads matching the given query
// Search Gmail for threads matching the given query
// Add this helper function at the top of your file
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Add this rate limit handler
  async function handleRateLimit(retryAfter = 60000) {
    console.log(`Rate limit hit, waiting ${retryAfter/1000} seconds...`);
    await delay(retryAfter);
  }
  
  // Modify searchEmails to handle rate limits
  async function searchEmails(query) {
    if (!accessToken) {
      throw new Error("No access token. Call getAuthToken() first.");
    }
  
    console.log("🔍 Searching emails with query:", query);
    let allThreads = [];
    let pageToken = null;
    let retryCount = 0;
  
    do {
      try {
        const url = `https://www.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${pageToken}` : ''}`;
  
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
  
        if (response.status === 403) {
          const errorData = await response.json();
          if (errorData.error?.errors?.[0]?.reason === 'rateLimitExceeded') {
            await handleRateLimit();
            continue; // Retry the same request
          }
        }
  
        if (!response.ok) {
          throw new Error(`Failed to search emails. Status: ${response.status}`);
        }
  
        const result = await response.json();
        if (result.threads) {
          allThreads = allThreads.concat(result.threads);
        }
        pageToken = result.nextPageToken;
        
        console.log(`✅ Found ${result.threads?.length || 0} threads on this page. Total so far: ${allThreads.length}`);
        
        // Add a small delay between requests to avoid hitting rate limits
        await delay(100);
      } catch (error) {
        console.error("Error in searchEmails:", error);
        retryCount++;
        if (retryCount > 3) throw error;
        await handleRateLimit();
      }
    } while (pageToken);
  
    console.log(`✅ Total search results: ${allThreads.length} threads`);
    return { threads: allThreads };
  }
  

// Check if label exists; if not, create it. Returns labelId
async function createOrGetLabel(labelName) {
  console.log("📌 Checking for existing label:", labelName);

  let response = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/labels",
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    console.error("❌ Error listing labels:", response.status, await response.text());
    throw new Error(`Error listing labels: ${response.status}`);
  }

  const data = await response.json();
  console.log("📋 Available labels:", data.labels); // Log all labels

  const existingLabel = data.labels?.find((lbl) => lbl.name === labelName);
  if (existingLabel) {
    console.log("✅ Existing label found:", existingLabel.id);
    return existingLabel.id;
  }

  console.log("🚀 Creating new label:", labelName);
  response = await fetch("https://www.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });

  if (!response.ok) {
    console.error("❌ Error creating label:", response.status, await response.text());
    throw new Error(`Error creating label: ${response.status}`);
  }

  const newLabel = await response.json();
  console.log("✅ New label created:", newLabel.id);
  return newLabel.id;
}

async function applyLabelToThreads(threadIds, labelId) {
    if (!threadIds?.length) {
      console.warn("⚠️ No valid threads to label.");
      return;
    }
  
    console.log("🚀 Applying label", labelId, "to threads:", threadIds.length);
  
    const batchSize = 900; // Keep below 1000 limit
    let successCount = 0;
  
    for (let i = 0; i < threadIds.length; i += batchSize) {
      const batchIds = threadIds.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(threadIds.length/batchSize)}`);
  
      const url = "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify";
  
      const bodyData = JSON.stringify({
        ids: batchIds,
        addLabelIds: [labelId],
        removeLabelIds: [],
      });
  
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: bodyData,
        });
  
        if (!response.ok) {
          const errorText = await response.text();
          console.error("❌ Failed to apply label to batch:", response.status, errorText);
          // Continue with next batch instead of throwing error
          continue;
        }
  
        console.log(`✅ Labels applied successfully to batch of ${batchIds.length} threads`);
        successCount += batchIds.length;
        
        // Add a small delay between batches
        await delay(1000);
      } catch (error) {
        console.error(`❌ Error applying labels to batch:`, error);
        // Continue with next batch instead of throwing error
        continue;
      }
    }
  
    if (successCount === 0) {
      throw new Error("Failed to apply labels to any threads");
    }
  
    console.log(`✅ Successfully labeled ${successCount} out of ${threadIds.length} threads`);
    return { 
      success: true,
      totalThreads: threadIds.length,
      successfulThreads: successCount
    };
  }

function buildQuery(labelName, startDate, endDate) {
    // Common receipt-related keywords and senders
    const receiptTerms = [
      "receipt",
      "order confirmation",
      "your order",
      "invoice",
      "purchase",
      "transaction",
      "payment",
    ];
  
    const commonSenders = [
      "amazon.com",
      "paypal",
      "square",
      "stripe",
      "walmart",
      "target",
      "bestbuy",
      "newegg",
      "homedepot",
      "lowes",
      "uber",
      "doordash",
      "grubhub",
      "ubereats",
      "stubhub",
      "ticketmaster",
      "steam",
    ];
  
    // Build the search query
    let query = "";
  
    // Add date range with explicit formatting
    if (startDate) {
      const formattedStartDate = startDate.replace(/\//g, '-');
      query += `after:${formattedStartDate} `;
    }
    if (endDate) {
      const formattedEndDate = endDate.replace(/\//g, '-');
      query += `before:${formattedEndDate} `;
    }
  
    // Add receipt keywords and common senders
    query += `(${receiptTerms.map((term) => `subject:(${term})`).join(" OR ")} OR `;
    query += `${commonSenders.map((sender) => `from:(${sender})`).join(" OR ")})`;
  
    // Additional filters to exclude common non-receipt emails
    query += ` -subject:(cancel -confirmed -cancellation -refund) -subject:"order status"`;
    query += ` -subject:(tracking -number -confirmed) -subject:(shipped -confirmation)`;
  
    console.log("📫 Built search query:", query);
    return query;
  }

  async function processThreadsForReceipts(threads) {
    const receiptThreads = [];
    const batchSize = 10; // Reduced batch size
    let retryCount = 0;
  
    for (let i = 0; i < threads.length; i += batchSize) {
      const batch = threads.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(threads.length/batchSize)}`);
      
      try {
        const batchPromises = batch.map(async (thread) => {
          try {
            await delay(100); // Add delay between each thread request
            const threadDetails = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=full`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            ).then((res) => {
              if (res.status === 403) {
                throw new Error('rateLimitExceeded');
              }
              return res.json();
            });
  
            const isReceipt =
              (await analyzeMessageContent(threadDetails)) || isLikelyReceipt(threadDetails);
  
            if (isReceipt) {
              return thread.id;
            }
          } catch (error) {
            if (error.message === 'rateLimitExceeded') {
              throw error; // Propagate rate limit error to outer try/catch
            }
            console.warn(`⚠️ Error processing thread ${thread.id}:`, error);
          }
          return null;
        });
  
        const batchResults = await Promise.all(batchPromises);
        receiptThreads.push(...batchResults.filter(id => id !== null));
        
        console.log(`Found ${receiptThreads.length} receipts so far...`);
        await delay(1000); // Add delay between batches
      } catch (error) {
        if (error.message === 'rateLimitExceeded') {
          await handleRateLimit();
          i -= batchSize; // Retry this batch
          continue;
        }
        retryCount++;
        if (retryCount > 3) throw error;
        await handleRateLimit();
      }
    }
  
    return receiptThreads;
  }
function isLikelyReceipt(threadDetails) {
  // Common receipt amount patterns
  const amountPatterns = [
    /\$\d+\.\d{2}/, // $XX.XX
    /total:?\s*\$?\d+\.\d{2}/i, // Total: $XX.XX
    /amount:?\s*\$?\d+\.\d{2}/i, // Amount: $XX.XX
    /payment:?\s*\$?\d+\.\d{2}/i, // Payment: $XX.XX
    /paid:?\s*\$?\d+\.\d{2}/i, // Paid: $XX.XX
    /\d+\.\d{2}\s*usd/i, // XX.XX USD
  ];

  // Common receipt confirmation patterns
  const confirmationPatterns = [
    /order\s*#?\s*\d+/i, // Order #1234
    /confirmation\s*#?\s*\d+/i, // Confirmation #1234
    /transaction\s*#?\s*\d+/i, // Transaction #1234
    /receipt\s*#?\s*\d+/i, // Receipt #1234
    /\byour order\b/i, // "your order"
    /\border confirmation\b/i, // "order confirmation"
    /\byour receipt\b/i, // "your receipt"
    /\bpayment received\b/i, // "payment received"
    /\bthanks for (?:your )?order\b/i, // "thanks for your order"
    /\bthanks for (?:your )?purchase\b/i, // "thanks for your purchase"
    /\bpurchase confirmation\b/i, // "purchase confirmation"
  ];

  const messages = threadDetails.messages || [];
  for (const message of messages) {
    const subject =
      message.payload?.headers?.find((h) => h.name.toLowerCase() === "subject")
        ?.value || "";
    const from =
      message.payload?.headers?.find((h) => h.name.toLowerCase() === "from")
        ?.value || "";
    const snippet = message.snippet || "";
    const textToCheck = `${subject} ${snippet}`.toLowerCase();

    // Check for amount patterns
    const hasAmount = amountPatterns.some((pattern) => pattern.test(textToCheck));

    // Check for confirmation patterns
    const hasConfirmation = confirmationPatterns.some((pattern) =>
      pattern.test(textToCheck)
    );

    // Check for known receipt senders (using our global `receiptSenders`)
    const isFromReceiptSender = receiptSenders.some((pattern) => pattern.test(from));

    // Consider it a receipt if:
    // 1. It has an amount AND (confirmation pattern OR is from a receipt sender)
    // 2. OR it has a confirmation pattern AND is from a receipt sender
    if (
      (hasAmount && (hasConfirmation || isFromReceiptSender)) ||
      (hasConfirmation && isFromReceiptSender)
    ) {
      return true;
    }
  }

  return false;
}

async function analyzeAttachments(message) {
    const features = {
        hasPDFAttachment: 0,
        hasInvoiceAttachment: 0,
        hasReceiptAttachment: 0,
        hasAttachmentWithAmount: 0
    };

    if (!message.payload.parts) return features;

    for (const part of message.payload.parts) {
        if (part.mimeType === 'application/pdf' || 
            part.mimeType === 'image/jpeg' || 
            part.mimeType === 'image/png') {
            
            features.hasPDFAttachment = 1;
            
            const filename = (part.filename || '').toLowerCase();
            if (filename.includes('invoice') || 
                filename.includes('bill') || 
                filename.includes('statement')) {
                features.hasInvoiceAttachment = 1;
            }
            
            if (filename.includes('receipt') || 
                filename.includes('order') || 
                filename.includes('confirmation')) {
                features.hasReceiptAttachment = 1;
            }
        }
    }

    return features;
}


async function analyzeMessageContent(threadDetails) {
    const features = {
        hasAmount: 0,
        hasConfirmation: 0,
        hasSubscription: 0,
        hasDownload: 0,
        hasLicense: 0,
        hasOrderNumber: 0,
        isFromKnownSender: 0,
        mentionsPayment: 0,
        hasAttachment: 0,
        isInvoiceOrReceipt: 0,
        textAnalysisScore: 0
    };

    const messages = threadDetails.messages || [];
    for (const message of messages) {
        // Add attachment analysis
        const attachmentFeatures = await analyzeAttachments(message);
        if (attachmentFeatures.hasPDFAttachment || 
            attachmentFeatures.hasInvoiceAttachment || 
            attachmentFeatures.hasReceiptAttachment) {
            features.hasAttachment = 1;
        }
        
        if (attachmentFeatures.hasInvoiceAttachment || 
            attachmentFeatures.hasReceiptAttachment) {
            features.isInvoiceOrReceipt = 1;
        }

        // Text analysis
        const subject = message.payload?.headers?.find(h => 
            h.name.toLowerCase() === 'subject')?.value || '';
        const from = message.payload?.headers?.find(h => 
            h.name.toLowerCase() === 'from')?.value || '';
        const body = message.snippet || '';
        const fullText = `${subject} ${body}`;
        
        // Get text analysis score
        const textScore = textAnalyzer.analyzeText(fullText);
        features.textAnalysisScore = Math.round(textScore * 10);

        // Standard checks
        if (/\$\d+\.\d{2}/.test(fullText)) features.hasAmount = 1;
        if (/order|confirmation|receipt/i.test(fullText)) features.hasConfirmation = 1;
        if (/subscription|recurring|monthly|yearly|annual/i.test(fullText)) features.hasSubscription = 1;
        if (/download|license key|serial|activation/i.test(fullText)) features.hasDownload = 1;
        if (/license|licensed|licensing/i.test(fullText)) features.hasLicense = 1;
        if (/order\s*#|confirmation\s*#/i.test(fullText)) features.hasOrderNumber = 1;
        if (/payment|paid|charge|invoice/i.test(fullText)) features.mentionsPayment = 1;

        // Check sender
        if (receiptSenders.some(pattern => pattern.test(from))) {
            features.isFromKnownSender = 1;
        }

        // Boost score for messages with both attachments and receipt-like text
        if (features.hasAttachment && features.textAnalysisScore > 5) {
            features.textAnalysisScore += 2;
        }
    }

    // Calculate weighted score
    const weightedScore = 
        features.hasAmount * 2 +
        features.hasConfirmation * 1.5 +
        features.hasSubscription * 1 +
        features.hasAttachment * 2 +
        features.isInvoiceOrReceipt * 3 +
        features.textAnalysisScore * 1.5 +
        features.isFromKnownSender * 2 +
        features.hasOrderNumber * 1.5 +
        features.mentionsPayment * 1.5;

    console.log("Enhanced analysis:", {
        features,
        weightedScore,
        isReceipt: weightedScore >= 5
    });

    return weightedScore >= 5;
}
// Listen for messages from popup.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "labelEmails") {
    const { labelName, startDate, endDate } = request;

    (async () => {
      try {
        console.log("Starting OAuth flow...");
        const token = await getAuthToken(true);
        console.log("OAuth flow complete, got token");

        const query = buildQuery(labelName, startDate, endDate);
        console.log("Search query built:", query);

        console.log("Starting email search...");
        const searchData = await searchEmails(query);
        const threads = searchData.threads || [];
        console.log(`Found ${threads.length} potential receipt threads`);

        // Filter for likely receipts
        const receiptThreads = await processThreadsForReceipts(threads);
        console.log(`Identified ${receiptThreads.length} likely receipt threads`);

        if (receiptThreads.length === 0) {
          sendResponse({
            success: true,
            message: "No receipt emails found in this date range.",
          });
          return;
        }

        console.log("Creating/getting label...");
        const labelId = await createOrGetLabel(labelName);

        console.log("Applying labels to threads...");
        const labelResult = await applyLabelToThreads(receiptThreads, labelId);
        sendResponse({
          success: true,
          message: `Labeled ${labelResult.successfulThreads} out of ${labelResult.totalThreads} receipt threads with "${labelName}".`,
        });
      } catch (error) {
        console.error("Detailed error:", {
          name: error.name,
          message: error.message,
          stack: error.stack,
          error: error,
        });

        sendResponse({
          success: false,
          message: `Error: ${error.message || "Unknown error"}`,
        });
      }
    })();
    return true;
  }
});
