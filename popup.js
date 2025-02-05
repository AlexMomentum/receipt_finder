async function getUserEmail() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, function (token) {
      if (chrome.runtime.lastError) {
        console.error("Failed to get auth token:", chrome.runtime.lastError);
        reject("Failed to get auth token.");
        return;
      }

      fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((user) => {
          if (user.email) {
            console.log("✅ User Email Detected:", user.email);
            resolve(user.email);
          } else {
            console.error("❌ No email found in response:", user);
            reject("No email found.");
          }
        })
        .catch((err) => {
          console.error("Error fetching user info:", err);
          reject("Error fetching user info.");
        });
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const labelNameInput = document.getElementById("labelName");
  const startDateInput = document.getElementById("startDate");
  const endDateInput = document.getElementById("endDate");
  const labelBtn = document.getElementById("labelBtn");
  const statusDiv = document.getElementById("status");
  const licenseKeyInput = document.getElementById("licenseKey");
  const submitLicenseBtn = document.getElementById("submitLicense");

  let userEmail = null;

  try {
    userEmail = await getUserEmail();
    console.log("✅ Detected User Email:", userEmail);
  } catch (error) {
    console.error("❌ Failed to get user email:", error);
    updateStatus("Error fetching your email. Please log into Chrome.", false);
    return;
  }

  // 🔹 Check if the user has a saved & verified license key
  const savedKey = localStorage.getItem("licenseKey");
  if (savedKey) {
    await verifyLicense(savedKey, userEmail); // Auto-verify license on load
  }

  submitLicenseBtn.addEventListener("click", async () => {
    const licenseKey = licenseKeyInput.value.trim();
    if (!licenseKey) {
      updateStatus("Please enter a license key.", false);
      return;
    }

    updateStatus("Verifying license...", true);
    await verifyLicense(licenseKey, userEmail);
  });

  async function verifyLicense(key, email) {
    try {
        const response = await fetch("https://receipt-finder.onrender.com/validate-key", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, key }), // ✅ Always send user email
        });

        const data = await response.json();
        console.log("License verification response:", data);

        if (data.valid) {
            localStorage.setItem("licenseKey", key); // Save key
            labelBtn.disabled = false; // Enable button
            updateStatus("✅ License verified! You can now use the extension.", true);

            // 🔹 Hide the entire license key section
            const licenseSection = document.getElementById("licenseSection"); // Add an ID to the wrapper div
            if (licenseSection) {
                licenseSection.style.display = "none";
            }
        } else {
            updateStatus("❌ Invalid license key. Please try again.", false);
        }
    } catch (error) {
        console.error("License verification failed:", error);
        updateStatus("Error verifying license. Please try again later.", false);
    }
}


  labelBtn.addEventListener("click", async () => {
    const labelName = labelNameInput.value.trim();
    const startDate = startDateInput.value.trim();
    const endDate = endDateInput.value.trim();

    if (!labelName) {
      updateStatus("Please enter a label name.", false);
      return;
    }

    labelBtn.disabled = true;
    updateStatus("Labeling in progress... Please wait.", true);

    chrome.runtime.sendMessage(
      { action: "labelEmails", labelName, startDate, endDate },
      (response) => {
        labelBtn.disabled = false;

        if (chrome.runtime.lastError) {
          console.error("Runtime error:", chrome.runtime.lastError);
          updateStatus(`Error: ${chrome.runtime.lastError.message}`, false);
          return;
        }
        if (response && response.success) {
          updateStatus(response.message, true);
        } else {
          updateStatus(`Error: ${response ? response.message : "Unknown error"}`, false);
        }
      }
    );
  });

  function updateStatus(msg, isSuccess) {
    statusDiv.textContent = msg;
    statusDiv.className = isSuccess ? "status success" : "status error";
  }
});
