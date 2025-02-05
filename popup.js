document.addEventListener("DOMContentLoaded", () => {
  const labelNameInput = document.getElementById("labelName");
  const startDateInput = document.getElementById("startDate");
  const endDateInput = document.getElementById("endDate");
  const labelBtn = document.getElementById("labelBtn");
  const statusDiv = document.getElementById("status");
  const licenseKeyInput = document.getElementById("licenseKey");
  const submitLicenseBtn = document.getElementById("submitLicense");

  
  
  async function getUserEmail() {
    return new Promise((resolve, reject) => {
        chrome.identity.getProfileUserInfo((userInfo) => {
            if (userInfo.email) {
                resolve(userInfo.email);
            } else {
                reject("No email found.");
            }
        });
    });
}

submitLicenseBtn.addEventListener("click", async () => {
    const licenseKey = licenseKeyInput.value.trim();
    if (!licenseKey) {
        updateStatus("Please enter a license key.", false);
        return;
    }

    updateStatus("Fetching your email...", true);

    try {
        const userEmail = await getUserEmail();
        console.log("User Email Detected:", userEmail);

        const response = await fetch("https://receipt-finder.onrender.com/validate-key", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ email: userEmail, key: licenseKey }) // Send email dynamically
        });

        const data = await response.json();
        console.log("License verification response:", data);

        if (data.valid) {
            localStorage.setItem("licenseKey", licenseKey); // Save key
            labelBtn.disabled = false; // Enable button
            updateStatus("License verified! You can now use the extension.", true);
        } else {
            updateStatus("Invalid license key. Please try again.", false);
        }
    } catch (error) {
        console.error("License verification failed:", error);
        updateStatus("Error verifying license. Please try again later.", false);
    }
});

  // Check if the user has already verified their license
  const savedKey = localStorage.getItem("licenseKey");
  if (savedKey) {
    verifyLicense(savedKey); // Automatically verify on load
  }

  // License verification
  submitLicenseBtn.addEventListener("click", async () => {
    const licenseKey = licenseKeyInput.value.trim();
    if (!licenseKey) {
      updateStatus("Please enter a license key.", false);
      return;
    }

    updateStatus("Verifying license...", true);

    try {
      const response = await fetch("https://receipt-finder.onrender.com/validate-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ key: licenseKey })
      });

      const data = await response.json();

      if (data.valid) {
        localStorage.setItem("licenseKey", licenseKey); // Save key
        labelBtn.disabled = false; // Enable button
        updateStatus("License verified! You can now use the extension.", true);
      } else {
        updateStatus("Invalid license key. Please try again.", false);
      }
    } catch (error) {
      console.error("License verification failed:", error);
      updateStatus("Error verifying license. Please try again later.", false);
    }
  });

  // Email labeling function
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
      {
        action: "labelEmails",
        labelName,
        startDate,
        endDate
      },
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
          updateStatus(`Error: ${response ? response.message : 'Unknown error'}`, false);
        }
      }
    );
  });

  function updateStatus(msg, isSuccess) {
    statusDiv.textContent = msg;
    statusDiv.className = isSuccess ? "status success" : "status error";
  }

  async function verifyLicense(key) {
    try {
      const response = await fetch("https://receipt-finder.onrender.com/validate-key", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ key })
      });

      const data = await response.json();
      if (data.valid) {
        labelBtn.disabled = false; // Enable button
        updateStatus("License verified! You can now use the extension.", true);
      } else {
        updateStatus("Invalid license key. Please enter a valid key.", false);
      }
    } catch (error) {
      console.error("License check failed:", error);
      updateStatus("Error verifying license. Try again later.", false);
    }
  }
});
