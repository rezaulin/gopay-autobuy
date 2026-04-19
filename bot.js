#!/usr/bin/env node
/**
 * GoPay Auto-Buy Bot for Stripe Checkout
 * 
 * Flow:
 * 1. Opens Stripe checkout link
 * 2. Selects GoPay payment method
 * 3. Clicks Subscribe/Pay
 * 4. Handles GoPay phone number input
 * 5. Waits for OTP (user provides via WhatsApp)
 * 6. Enters OTP and completes payment
 * 7. Can loop for multiple checkout links
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const readline = require('readline');

puppeteer.use(StealthPlugin());

// ── Config ──
const CONFIG = {
  gopayNumber: '',       // Set via --phone or prompt
  headless: process.env.DISPLAY ? false : 'new', // Auto-detect: use display if available, else headless
  timeout: 120000,       // 120s timeout per step
  slowMo: 100,           // Slow down actions to look human
};

// ── Helpers ──
function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function err(msg) {
  console.error(`[ERROR] ${msg}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Core Functions ──

async function launchBrowser() {
  log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: CONFIG.headless,
    slowMo: CONFIG.slowMo,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
  return browser;
}

async function openCheckout(page, checkoutUrl) {
  log(`Opening checkout: ${checkoutUrl.substring(0, 60)}...`);
  // Try with domcontentloaded first (faster), fallback to load
  try {
    await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await sleep(3000);
    // Wait for the GoPay radio to appear (actual page ready indicator)
    await page.waitForSelector('#payment-method-accordion-item-title-gopay', { timeout: 30000 });
    log('Checkout page loaded.');
  } catch(e) {
    log(`First load attempt: ${e.message.substring(0, 80)}`);
    // Retry with longer timeout
    try {
      await page.goto(checkoutUrl, { waitUntil: 'load', timeout: 120000 });
      await sleep(5000);
      log('Checkout page loaded (retry).');
    } catch(e2) {
      log(`Load retry failed: ${e2.message.substring(0, 80)}`);
    }
  }
}

async function selectGoPay(page) {
  log('Selecting GoPay payment method...');
  
  try {
    // Wait for the GoPay radio to appear
    await page.waitForSelector('#payment-method-accordion-item-title-gopay', { timeout: 10000 });
    await sleep(1000);
    
    // Use CDP for reliable click (bypasses React/Shadow DOM protection)
    const cdp = await page.target().createCDPSession();
    
    // Get the EXACT radio button visible position
    const pos = await page.evaluate(() => {
      const radio = document.getElementById('payment-method-accordion-item-title-gopay');
      if (!radio) return null;
      const rect = radio.getBoundingClientRect();
      // Also check parent containers for a bigger clickable area
      let parent = radio.parentElement;
      let biggestRect = rect;
      while (parent && parent !== document.body) {
        const pr = parent.getBoundingClientRect();
        if (pr.width > biggestRect.width && pr.height >= biggestRect.height && pr.width < 500) {
          biggestRect = pr;
        }
        if (parent.tagName === 'LI') break;
        parent = parent.parentElement;
      }
      return { 
        radio: { x: rect.x + rect.width/2, y: rect.y + rect.height/2, w: rect.width, h: rect.height },
        container: { x: biggestRect.x + 20, y: biggestRect.y + biggestRect.height/2, w: biggestRect.width, h: biggestRect.height }
      };
    });
    
    if (!pos) {
      log('GoPay radio element not found!');
      return;
    }
    
    // First try clicking the radio button directly
    log(`Clicking GoPay radio at (${Math.round(pos.radio.x)}, ${Math.round(pos.radio.y)}) via CDP...`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.radio.x, y: pos.radio.y });
    await sleep(200);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.radio.x, y: pos.radio.y, button: 'left', clickCount: 1 });
    await sleep(50);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.radio.x, y: pos.radio.y, button: 'left', clickCount: 1 });
    
    await sleep(2000);
    
    // Verify
    let isSelected = await page.evaluate(() => {
      const r = document.getElementById('payment-method-accordion-item-title-gopay');
      return r ? (r.checked || r.getAttribute('aria-checked') === 'true') : false;
    });
    
    if (isSelected) {
      log('✅ GoPay selected via radio click.');
      return;
    }
    
    // Fallback: click the container area
    log('Radio click did not select. Trying container click...');
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.container.x, y: pos.container.y });
    await sleep(200);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.container.x, y: pos.container.y, button: 'left', clickCount: 1 });
    await sleep(50);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.container.x, y: pos.container.y, button: 'left', clickCount: 1 });
    
    await sleep(2000);
    
    isSelected = await page.evaluate(() => {
      const r = document.getElementById('payment-method-accordion-item-title-gopay');
      return r ? (r.checked || r.getAttribute('aria-checked') === 'true') : false;
    });
    
    if (isSelected) {
      log('✅ GoPay selected via container click.');
    } else {
      log('⚠️ GoPay not selected. Checking for expand state...');
      // Maybe GoPay is already expanded (accordion). Check if it shows GoPay-specific content
      const hasGoPayForm = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes('Pay with GoPay') || text.includes('GoPay');
      });
      if (hasGoPayForm) {
        log('GoPay content is visible. Proceeding...');
      }
    }
    
  } catch (e) {
    log(`GoPay selection error: ${e.message}`);
  }
}

async function clickSubscribe(page) {
  log('Clicking Subscribe/Pay button...');
  
  try {
    const cdp = await page.target().createCDPSession();
    
    // Find the submit button position
    const btnPos = await page.evaluate(() => {
      // Try "Pay with GoPay" first
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        if (btn.textContent.toLowerCase().includes('pay with gopay')) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, text: 'Pay with GoPay' };
        }
      }
      // Fallback to Subscribe
      const sub = document.querySelector('button[type="submit"]');
      if (sub) {
        const rect = sub.getBoundingClientRect();
        if (rect.width > 0) return { x: rect.x + rect.width/2, y: rect.y + rect.height/2, text: 'Subscribe' };
      }
      return null;
    });
    
    if (btnPos) {
      log(`Clicking "${btnPos.text}" at (${Math.round(btnPos.x)}, ${Math.round(btnPos.y)}) via CDP...`);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btnPos.x, y: btnPos.y });
      await sleep(100);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btnPos.x, y: btnPos.y, button: 'left', clickCount: 1 });
      await sleep(50);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btnPos.x, y: btnPos.y, button: 'left', clickCount: 1 });
      log('Clicked via CDP.');
    } else {
      log('Could not find subscribe button position.');
    }
    
    await sleep(3000);
    
  } catch (e) {
    log(`Button click error: ${e.message}`);
  }
}

async function handleGoPayFlow(page, browser, gopayNumber) {
  log('Handling GoPay payment flow...');
  
  // Save current page count to detect new popups/tabs
  const initialPages = (await browser.pages()).length;
  
  // Check if there's a billing form that needs to be filled first
  const hasBillingForm = await page.$('#billingName');
  if (hasBillingForm) {
    log('Found billing address form. Filling in...');
    await fillBillingAddress(page);
    
    // Click Subscribe via CDP
    await sleep(1000);
    try {
      const cdp = await page.target().createCDPSession();
      const subPos = await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]');
        if (btn) {
          const rect = btn.getBoundingClientRect();
          return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
        }
        return null;
      });
      if (subPos) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: subPos.x, y: subPos.y });
        await sleep(100);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: subPos.x, y: subPos.y, button: 'left', clickCount: 1 });
        await sleep(50);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: subPos.x, y: subPos.y, button: 'left', clickCount: 1 });
        log('Clicked submit via CDP (1st time after billing).');
      }
    } catch(e) {
      log(`CDP submit click failed: ${e.message}`);
    }
    
    // Wait for form to process and check button state
    log('Waiting for form validation...');
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const btnState = await page.evaluate(() => {
        const btn = document.querySelector('button[type="submit"]');
        return btn ? { classes: btn.className, text: btn.textContent } : null;
      }).catch(() => null);
      
      if (btnState) {
        log(`Button state: ${btnState.classes.includes('complete') ? '✅ COMPLETE' : '⏳ incomplete'}`);
        if (btnState.classes.includes('complete')) {
          // Form is valid - click submit again via CDP
          log('Form is complete! Clicking Subscribe again...');
          try {
            const cdp2 = await page.target().createCDPSession();
            const subPos2 = await page.evaluate(() => {
              const btn = document.querySelector('button[type="submit"]');
              if (btn) {
                const rect = btn.getBoundingClientRect();
                return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
              }
              return null;
            });
            if (subPos2) {
              await cdp2.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: subPos2.x, y: subPos2.y });
              await sleep(100);
              await cdp2.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: subPos2.x, y: subPos2.y, button: 'left', clickCount: 1 });
              await sleep(50);
              await cdp2.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: subPos2.x, y: subPos2.y, button: 'left', clickCount: 1 });
              log('Clicked submit via CDP (2nd time - form complete).');
            }
          } catch(e) {}
          break;
        }
      }
    }
    
    // After clicking submit with complete form, wait for GoPay redirect/modal
    log('Waiting for GoPay payment flow...');
    await sleep(5000);
  } else {
    // Already past billing form, just wait
    await sleep(3000);
  }
  
  // Now find the active page with GoPay/payment content
  return await findGoPayPage(browser, initialPages, gopayNumber, page);
}

async function fillBillingAddress(page) {
  log('Filling billing address...');
  
  // Use page.type() which triggers proper input events for React
  const fields = [
    { sel: '#billingName', value: 'Ahmad Rizki', label: 'name' },
    { sel: '#billingAddressLine1', value: 'Jl. Sudirman No. 123', label: 'address' },
    { sel: '#billingLocality', value: 'Jakarta Selatan', label: 'city' },
    { sel: '#billingPostalCode', value: '12190', label: 'postal code' },
  ];
  
  for (const field of fields) {
    try {
      const el = await page.$(field.sel);
      if (el) {
        // Triple-click to select all text in field
        await el.click({ clickCount: 3 });
        await sleep(200);
        // Use Puppeteer's built-in select all
        await el.click({ clickCount: 1 });
        await page.keyboard.down('Control');
        await page.keyboard.press('A');
        await page.keyboard.up('Control');
        await sleep(100);
        // Delete selected text
        await page.keyboard.press('Backspace');
        await sleep(100);
        // Type new value
        await page.keyboard.type(field.value, { delay: 30 });
        log(`Typed ${field.label}: ${field.value}`);
        await sleep(300);
        // Tab out to trigger blur/validation
        await page.keyboard.press('Tab');
        await sleep(500);
      }
    } catch(e) {
      log(`Error filling ${field.label}: ${e.message}`);
    }
  }
  
  // Set country to Indonesia using page.select() (native select handling)
  try {
    await page.select('#billingCountry', 'ID');
    log('Selected country: Indonesia (ID)');
    await sleep(500);
    await page.keyboard.press('Tab');
    await sleep(500);
  } catch(e) {
    // Fallback: type into the select if it's a custom dropdown
    log(`Select failed (${e.message}), trying JS...`);
    await page.evaluate(() => {
      const sel = document.getElementById('billingCountry');
      if (sel) {
        sel.value = 'ID';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }
  
  // Set administrative area (state/province) if visible
  try {
    const adminArea = await page.$('#billingAdministrativeArea');
    if (adminArea) {
      const isVisible = await page.evaluate(el => el.offsetParent !== null, adminArea);
      if (isVisible) {
        // Get available options
        const options = await page.evaluate(() => {
          const sel = document.getElementById('billingAdministrativeArea');
          return Array.from(sel.options).map(o => ({ value: o.value, text: o.text }));
        });
        log(`Admin area options: ${options.length}`);
        
        // Try to select DKI Jakarta or similar
        const jakarta = options.find(o => o.text.includes('Jakarta') || o.value.includes('JK'));
        if (jakarta) {
          await page.select('#billingAdministrativeArea', jakarta.value);
          log(`Selected admin area: ${jakarta.text}`);
        } else if (options.length > 1) {
          await page.select('#billingAdministrativeArea', options[1].value);
          log(`Selected first admin area: ${options[1].text}`);
        }
        await sleep(500);
      }
    }
  } catch(e) {
    log(`Admin area: ${e.message}`);
  }
  
  // Press Tab to trigger final validation
  await page.keyboard.press('Tab');
  await sleep(1000);
  
  // Verify values are set
  const verify = await page.evaluate(() => {
    return {
      name: document.getElementById('billingName')?.value,
      country: document.getElementById('billingCountry')?.value,
      address: document.getElementById('billingAddressLine1')?.value,
      city: document.getElementById('billingLocality')?.value,
      zip: document.getElementById('billingPostalCode')?.value,
    };
  });
  log(`Verified billing: ${JSON.stringify(verify)}`);
}

async function findGoPayPage(browser, initialPages, gopayNumber, originalPage) {
  const maxAttempts = 15;
  let lastUrl = '';
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(2000);
    
    try {
      const allPages = await browser.pages();
      
      for (const p of allPages) {
        try {
          const url = p.url();
          if (url === 'about:blank' || url === lastUrl) continue;
          
          // Check for GoPay-specific content (not just Stripe checkout)
          const content = await p.evaluate(() => {
            const body = document.body?.innerText || '';
            const inputs = Array.from(document.querySelectorAll('input'));
            const phoneInputs = inputs.filter(i => {
              if (i.id === 'phoneNumber') return false; // Skip Link phone
              return (i.type === 'tel' || i.name?.includes('phone') || i.placeholder?.toLowerCase().includes('phone'));
            });
            
            return {
              text: body.substring(0, 800),
              hasGoPayOnly: body.includes('GoPay') && !body.includes('Card'), // GoPay-specific page
              hasOTP: body.toLowerCase().includes('otp') || body.toLowerCase().includes('verification code') || body.toLowerCase().includes('masukkan kode'),
              hasPhoneInput: phoneInputs.length > 0 && phoneInputs.some(i => i.offsetParent !== null),
              isStripeCheckout: body.includes('Subscribe to') && body.includes('Payment method'),
              url: window.location.href,
              inputCount: inputs.length,
              phoneInputIds: phoneInputs.map(i => i.id)
            };
          });
          
          // Skip if still on Stripe checkout page (has both GoPay and Card options)
          if (content.isStripeCheckout) {
            continue;
          }
          
          // Found a non-Stripe page - this could be the GoPay redirect
          if (content.hasPhoneInput) {
            log(`Found page with phone input: ${url.substring(0, 60)}`);
            log(`Phone input IDs: ${JSON.stringify(content.phoneInputIds)}`);
            await enterPhoneNumber(p, gopayNumber);
            return p;
          }
          
          if (content.hasGoPayOnly || content.hasOTP) {
            log(`Found GoPay/OTP page: ${url.substring(0, 60)}`);
            log(`Content: ${content.text.substring(0, 300)}`);
            
            // Wait for it to load fully
            await sleep(3000);
            
            // Re-check for phone input
            const hasPhone = await p.evaluate(() => {
              const inputs = document.querySelectorAll('input[type="tel"], input[name*="phone"]:not(#phoneNumber)');
              return Array.from(inputs).some(i => i.offsetParent !== null);
            });
            
            if (hasPhone) {
              await enterPhoneNumber(p, gopayNumber);
              return p;
            }
          }
          
          lastUrl = url;
          
        } catch(e) {
          if (e.message.includes('detached Frame') || e.message.includes('Execution context')) {
            continue; // Page is navigating, skip
          }
        }
      }
      
      if (attempt % 3 === 0) {
        log(`Attempt ${attempt + 1}/${maxAttempts}: Waiting for GoPay redirect...`);
      }
      
    } catch(e) {
      log(`Error in findGoPayPage: ${e.message}`);
    }
  }
  
  // Fallback: check all pages for any usable state
  log('Exhausted attempts. Checking all pages...');
  const allPages = await browser.pages();
  for (const p of allPages) {
    try {
      const url = p.url();
      if (url !== 'about:blank') {
        log(`Remaining page: ${url.substring(0, 80)}`);
      }
    } catch(e) {}
  }
  
  return allPages[allPages.length - 1] || originalPage;
}

async function enterPhoneNumber(page, gopayNumber) {
  const phoneSelectors = [
    'input[type="tel"]',
    'input[name*="phone"]',
    'input[placeholder*="phone"]',
    'input[placeholder*="Phone"]',
    'input[placeholder*="nomor"]',
    'input[placeholder*="Nomor"]',
    'input[id*="phone"]',
  ];
  
  for (const sel of phoneSelectors) {
    try {
      const inputs = await page.$$(sel);
      for (const input of inputs) {
        const info = await page.evaluate(el => {
          return {
            visible: el.offsetParent !== null,
            id: el.id,
            name: el.name,
            isLink: el.id === 'phoneNumber' || el.closest('.SignUpForm') !== null || el.closest('[class*="SignUp"]') !== null,
            placeholder: el.placeholder
          };
        }, input);
        
        // Skip Stripe Link phone input
        if (info.isLink) {
          log(`Skipping Stripe Link phone input (${info.id})`);
          continue;
        }
        
        if (info.visible) {
          log(`Entering GoPay number: ${gopayNumber}`);
          await input.click({ clickCount: 3 });
          await sleep(300);
          await input.type(gopayNumber, { delay: 50 });
          await sleep(1000);
          
          // Submit
          const buttons = await page.$$('button, input[type="submit"]');
          for (const btn of buttons) {
            const text = await page.evaluate(el => (el.textContent || el.value || '').trim(), btn);
            const lower = text.toLowerCase();
            if (lower.includes('continue') || lower.includes('pay') || 
                lower.includes('confirm') || lower.includes('submit') ||
                lower.includes('verify') || lower.includes('bayar') ||
                lower.includes('send') || lower.includes('kirim')) {
              await btn.click();
              log(`Clicked "${text}" button.`);
              await sleep(2000);
              return true;
            }
          }
          
          // If no button found, press Enter
          await page.keyboard.press('Enter');
          log('Pressed Enter to submit phone number.');
          return true;
        }
      }
    } catch(e) {
      // Frame might have detached - that's OK
      if (e.message.includes('detached Frame')) {
        log('Frame detached after interaction (page navigated). This is expected.');
        return true;
      }
    }
  }
  
  log('Could not find GoPay phone input.');
  return false;
}

async function waitForOTPPage(page) {
  log('Waiting for OTP input page...');
  
  // Wait for OTP input fields (usually 6 digits)
  const maxWait = 120000; // 2 minutes
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWait) {
    // Check for OTP-specific inputs (exclude billing fields)
    const otpInputs = await page.evaluate(() => {
      const results = [];
      const inputs = document.querySelectorAll('input');
      for (const input of inputs) {
        const id = input.id || '';
        const name = input.name || '';
        const placeholder = input.placeholder || '';
        const cls = input.className || '';
        
        // Skip billing/address fields
        if (id.includes('billing') || name.includes('billing') || 
            id.includes('address') || name.includes('address') ||
            id.includes('postal') || name.includes('postal') ||
            id.includes('zip') || name.includes('zip')) continue;
        
        // Check for OTP indicators
        const isOTP = (
          (input.maxLength === 1 && input.inputMode === 'numeric') ||
          (input.type === 'number' && input.maxLength >= 4 && input.maxLength <= 8) ||
          id.toLowerCase().includes('otp') ||
          name.toLowerCase().includes('otp') ||
          placeholder.toLowerCase().includes('otp') ||
          placeholder.toLowerCase().includes('verification') ||
          placeholder.toLowerCase().includes('kode verifikasi') ||
          (cls.toLowerCase().includes('otp'))
        );
        
        if (isOTP && input.offsetParent !== null) {
          results.push({ id, name, type: input.type, maxLength: input.maxLength, placeholder });
        }
      }
      return results;
    });
    
    if (otpInputs.length > 0) {
      log(`Found ${otpInputs.length} OTP input(s): ${JSON.stringify(otpInputs[0])}`);
      // Get actual DOM elements
      const handles = [];
      for (const info of otpInputs) {
        const sel = info.id ? `#${info.id}` : `input[name="${info.name}"]`;
        const el = await page.$(sel);
        if (el) handles.push(el);
      }
      if (handles.length > 0) {
        return { type: 'otp_inputs', inputs: handles };
      }
    }
    
    // Check for single OTP field with specific attributes
    const singleOtp = await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="tel"], input[type="number"], input[type="text"]');
      for (const input of inputs) {
        if (input.id?.includes('billing') || input.name?.includes('billing') ||
            input.id?.includes('postal') || input.name?.includes('postal')) continue;
            
        const maxLen = parseInt(input.getAttribute('maxlength') || '0');
        const placeholder = (input.placeholder || '').toLowerCase();
        
        if ((maxLen >= 4 && maxLen <= 8) || 
            placeholder.includes('otp') || 
            placeholder.includes('verification') ||
            placeholder.includes('kode')) {
          return { found: true, id: input.id, maxLength: maxLen, placeholder: input.placeholder };
        }
      }
      return { found: false };
    });
    
    if (singleOtp.found) {
      log(`Found single OTP field: ${JSON.stringify(singleOtp)}`);
      const sel = singleOtp.id ? `#${singleOtp.id}` : null;
      if (sel) {
        const el = await page.$(sel);
        if (el) return { type: 'single_otp', input: el };
      }
    }
    
    // Check page content for OTP-related text
    const hasOtpText = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('otp') || text.includes('verification code') || 
             text.includes('kode verifikasi') || text.includes('enter code');
    });
    
    if (hasOtpText) {
      log('Page mentions OTP but no specific input found yet. Waiting...');
    }
    
    await sleep(2000);
  }
  
  log('Timeout waiting for OTP page. Manual intervention may be needed.');
  return null;
}

async function enterOTP(page, otp, otpInfo) {
  log(`Entering OTP: ${otp}`);
  
  if (otpInfo.type === 'otp_inputs') {
    // Multiple single-digit inputs
    for (let i = 0; i < otpInfo.inputs.length && i < otp.length; i++) {
      await otpInfo.inputs[i].click();
      await otpInfo.inputs[i].type(otp[i], { delay: 100 });
      await sleep(200);
    }
  } else if (otpInfo.type === 'single_otp') {
    // Single input for all digits
    await otpInfo.input.click({ clickCount: 3 });
    await otpInfo.input.type(otp, { delay: 100 });
  } else {
    // Fallback: find any visible input and type
    log('Using fallback OTP entry...');
    const inputs = await page.$$('input[type="tel"], input[type="number"], input[type="text"]');
    for (const input of inputs) {
      const visible = await page.evaluate(el => el.offsetParent !== null, input);
      if (visible) {
        await input.click();
        await input.type(otp, { delay: 100 });
        break;
      }
    }
  }
  
  await sleep(1000);
  
  // Try to submit OTP
  const submitted = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button, input[type="submit"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').toLowerCase();
      if (text.includes('verify') || text.includes('submit') || text.includes('confirm') || 
          text.includes('verifikasi') || text.includes('lanjut') || text.includes('continue')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
  
  if (submitted) {
    log('OTP submitted.');
  } else {
    log('Auto-submit not found. Pressing Enter...');
    await page.keyboard.press('Enter');
  }
  
  await sleep(5000);
}

async function waitForCompletion(page) {
  log('Waiting for payment completion...');
  
  const maxWait = 60000;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWait) {
    const url = page.url();
    const content = await page.evaluate(() => document.body.innerText.toLowerCase());
    
    if (content.includes('success') || content.includes('berhasil') || content.includes('thank you') || 
        content.includes('terima kasih') || content.includes('confirmed') || content.includes('complete')) {
      log('✅ Payment completed successfully!');
      return true;
    }
    
    if (content.includes('failed') || content.includes('gagal') || content.includes('error')) {
      err('❌ Payment failed!');
      return false;
    }
    
    // Check if redirected back to a success URL
    if (url.includes('success') || url.includes('thank')) {
      log('✅ Redirected to success page!');
      return true;
    }
    
    await sleep(2000);
  }
  
  log('⚠️ Completion status unclear. Check browser manually.');
  return null;
}

// ── Main Flow ──

async function processCheckout(browser, checkoutUrl, gopayNumber) {
  const page = await browser.newPage();
  
  try {
    // Step 1: Open checkout
    await openCheckout(page, checkoutUrl);
    
    // Step 2: Select GoPay
    await selectGoPay(page);
    
    // Step 3: Click Subscribe
    await clickSubscribe(page);
    
    // Step 4: Handle GoPay flow (phone number)
    const activePage = await handleGoPayFlow(page, browser, gopayNumber);
    
    // Step 5: Wait for user to provide OTP
    const otpInfo = await waitForOTPPage(activePage);
    
    if (otpInfo) {
      const otp = await ask('📱 Enter OTP from WhatsApp: ');
      if (otp && otp.length >= 4) {
        await enterOTP(activePage, otp, otpInfo);
        
        // Step 6: Wait for completion
        const result = await waitForCompletion(activePage);
        return result;
      } else {
        err('Invalid OTP provided.');
        return false;
      }
    } else {
      err('Could not find OTP input. Check browser.');
      await ask('Press Enter when done manually or Ctrl+C to abort...');
      return null;
    }
    
  } catch (e) {
    err(`Flow error: ${e.message}`);
    return false;
  } finally {
    await page.close();
  }
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   💰 GoPay Auto-Buy Bot - Stripe        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  
  // Get GoPay number
  let gopayNumber = CONFIG.gopayNumber;
  if (!gopayNumber) {
    gopayNumber = await ask('📱 Enter GoPay phone number (e.g., 08123456789): ');
  }
  
  // Clean up number - remove country code prefix if present
  if (gopayNumber.startsWith('+62')) {
    gopayNumber = '0' + gopayNumber.substring(3);
  } else if (gopayNumber.startsWith('62')) {
    gopayNumber = '0' + gopayNumber.substring(2);
  }
  
  log(`GoPay number: ${gopayNumber}`);
  
  // Get checkout links
  let checkoutLinks = [];
  if (CONFIG.directUrls && CONFIG.directUrls.length > 0) {
    checkoutLinks = CONFIG.directUrls.map(u => u.replace(/^['"]|['"]$/g, ''));
    log(`Using ${checkoutLinks.length} URL(s) from --urls argument`);
  } else if (CONFIG.directUrl) {
    // Strip surrounding quotes (Windows CMD doesn't strip single quotes)
    checkoutLinks = [CONFIG.directUrl.replace(/^['"]|['"]$/g, '')];
    log('Using URL from --url argument');
  } else {
    const linksInput = await ask('🔗 Enter checkout link(s) (comma-separated for multiple): ');
    checkoutLinks = linksInput.split(',').map(l => l.trim()).filter(l => l.length > 0);
  }
  
  if (checkoutLinks.length === 0) {
    err('No checkout links provided!');
    process.exit(1);
  }
  
  log(`Processing ${checkoutLinks.length} checkout(s)...`);
  
  const browser = await launchBrowser();
  const results = [];
  
  for (let i = 0; i < checkoutLinks.length; i++) {
    console.log('');
    log(`═══ Processing checkout ${i + 1}/${checkoutLinks.length} ═══`);
    
    const result = await processCheckout(browser, checkoutLinks[i], gopayNumber);
    results.push({ link: checkoutLinks[i].substring(0, 40), success: result });
    
    if (i < checkoutLinks.length - 1) {
      const cont = await ask('\n➡️ Continue to next checkout? (y/n): ');
      if (cont.toLowerCase() !== 'y') {
        log('Stopping...');
        break;
      }
    }
  }
  
  // Summary
  console.log('');
  console.log('═══════════════════════════════════════');
  console.log('📊 SUMMARY');
  console.log('═══════════════════════════════════════');
  results.forEach((r, i) => {
    const status = r.success === true ? '✅' : r.success === false ? '❌' : '⚠️';
    console.log(`  ${i + 1}. ${status} ${r.link}...`);
  });
  console.log('');
  
  await browser.close();
  log('Done. Browser closed.');
}

// ── CLI Args ──
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--phone' && args[i + 1]) {
    CONFIG.gopayNumber = args[i + 1];
    i++;
  }
  if (args[i] === '--headless') {
    CONFIG.headless = true;
  }
  if (args[i] === '--url' && args[i + 1]) {
    CONFIG.directUrl = args[i + 1];
    i++;
  }
  if (args[i] === '--urls' && args[i + 1]) {
    // Multiple URLs separated by comma
    CONFIG.directUrls = args[i + 1].split(',').map(l => l.trim()).filter(l => l);
    i++;
  }
}

main().catch(e => {
  err(`Fatal: ${e.message}`);
  process.exit(1);
});
