var currentChauffeur = null;
var activeViewId = 'authView';
var pendingBookingsData = []; // Stores [{ bookingId, customerName }, ...]
var activeShiftBookings = [];
var completedBookingsLocal = []; // Tracks booking IDs completed during the active shift
var punchedInBookingsLocal = []; // Tracks booking IDs punched in during the active shift
var currentPunchMode = 'ACTIVE'; // Tracks if form is standard active shift or pending missed shift
var submittedPhotosLocal = {}; // NEW
var readinessPhotosArray = []; // NEW: holds File objects for multi-photo readiness capture

document.addEventListener('DOMContentLoaded', function () {
  checkSession();

  const readinessForm = document.getElementById('readinessForm');
  if (readinessForm) {
    readinessForm.addEventListener('change', function (e) {
      if (e.target.name === 'vrClean' || e.target.name === 'vrAmenities' || e.target.name === 'vrReady') {
        updateReadinessSubmitState();
      }
    });
  }
});

var shiftWatcherInterval = null;
var isEndingShift = false; // guard against double-submission (manual + auto racing)

function startShiftWatcher() {
  if (shiftWatcherInterval) return; // already running
  shiftWatcherInterval = setInterval(checkShiftAutoEnd, 60 * 1000); // check every 1 minute
}

function stopShiftWatcher() {
  if (shiftWatcherInterval) {
    clearInterval(shiftWatcherInterval);
    shiftWatcherInterval = null;
  }
}

function checkShiftAutoEnd() {
  const shiftState = localStorage.getItem('shiftState');
  const startTimeStr = localStorage.getItem('shiftStartTime');

  if (shiftState !== 'ACTIVE' || !startTimeStr || isEndingShift) return;

  const startTime = new Date(startTimeStr);
  if (isNaN(startTime.getTime())) return;

  const elapsedMs = Date.now() - startTime.getTime();
  const fourteenHoursMs = 14 * 60 * 60 * 1000;

  if (elapsedMs >= fourteenHoursMs) {
    autoEndShift();
  }
}

function finalizeShiftEnd(wasAutoEnded) {
  localStorage.setItem('shiftState', 'PRE_SHIFT');
  localStorage.removeItem('shiftStartTime');

  const missedPunchIns = activeShiftBookings.filter(b => !punchedInBookingsLocal.includes(b.bookingId));
  const missedPunchOuts = activeShiftBookings.filter(b => !completedBookingsLocal.includes(b.bookingId));

  const existingMissedStr = localStorage.getItem('missedForms');
  let existingMissed = { punchIns: [], punchOuts: [] };
  if (existingMissedStr) existingMissed = JSON.parse(existingMissedStr);

  const finalMissedPunchIns = [...existingMissed.punchIns, ...missedPunchIns].reduce((acc, current) => {
    if (!acc.find(item => item.bookingId === current.bookingId)) acc.push(current);
    return acc;
  }, []);

  const finalMissedPunchOuts = [...existingMissed.punchOuts, ...missedPunchOuts].reduce((acc, current) => {
    if (!acc.find(item => item.bookingId === current.bookingId)) acc.push(current);
    return acc;
  }, []);

  localStorage.setItem('missedForms', JSON.stringify({
    punchIns: finalMissedPunchIns,
    punchOuts: finalMissedPunchOuts
  }));

  activeShiftBookings = [];
  completedBookingsLocal = [];
  punchedInBookingsLocal = [];
  localStorage.removeItem('completedBookingsLocal');
  localStorage.removeItem('punchedInBookingsLocal');
  localStorage.removeItem('submittedPhotosLocal');
  document.getElementById('punchInBookingsRadioList').innerHTML = '<p class="placeholder-text">Please click Start Shift to view bookings.</p>';
  document.getElementById('pendingBookingsCheckboxList').innerHTML = '<p class="placeholder-text">Please click Start Shift to view bookings.</p>';

  isEndingShift = false;
  showDashboardView();

  if (wasAutoEnded) {
    alert('Your 14-hour shift limit was reached, so your shift was automatically ended. Any unfinished Punch In/Out forms have been moved to Pending Forms.');
  } else {
    alert('Shift ended successfully! Photo uploaded.');
  }
}

async function autoEndShift() {
  if (isEndingShift) return;
  isEndingShift = true;

  try {
    const formData = new FormData();
    formData.append('chauffeurName', currentChauffeur.name);
    formData.append('chauffeurNumber', currentChauffeur.number);
    formData.append('isAutoEnd', 'true'); // tells backend: do NOT write Log Out Time
    const shiftRowIndex = localStorage.getItem('shiftRowIndex');
    if (shiftRowIndex) formData.append('shiftRowIndex', shiftRowIndex);
    // No 'clientTimestamp' sent — irrelevant since backend skips column U anyway.
    // No 'image' field — backend already treats it as optional.

    const res = await fetch('/api/shift/end', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok || data.error) {
      console.error('Auto end-shift failed:', data.error);
      isEndingShift = false;
      return; // will retry on next interval tick
    }

    finalizeShiftEnd(true);
  } catch (err) {
    console.error('Auto end-shift error:', err);
    isEndingShift = false;
  }
}



// Custom confirm dialog box for starting shift
function showCustomConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('customConfirmOverlay');
    const msgEl = document.getElementById('customConfirmMessage');
    const okBtn = document.getElementById('customConfirmOkBtn');
    const cancelBtn = document.getElementById('customConfirmCancelBtn');

    msgEl.textContent = message;
    overlay.classList.remove('display-none');

    function cleanup(result) {
      overlay.classList.add('display-none');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// Check active session
function checkSession() {
  const savedChauffeur = localStorage.getItem('chauffeur');
  if (!savedChauffeur) {
    showAuthView();
    return;
  }

  currentChauffeur = JSON.parse(savedChauffeur);
  updateChauffeurUI();
  updatePendingWidget();
  startShiftWatcher();
  checkShiftAutoEnd();

  const savedPunchedIn = localStorage.getItem('punchedInBookingsLocal');
  punchedInBookingsLocal = savedPunchedIn ? JSON.parse(savedPunchedIn) : [];

  const savedCompleted = localStorage.getItem('completedBookingsLocal');
  completedBookingsLocal = savedCompleted ? JSON.parse(savedCompleted) : [];

  const savedSubmittedPhotos = localStorage.getItem('submittedPhotosLocal');
  submittedPhotosLocal = savedSubmittedPhotos ? JSON.parse(savedSubmittedPhotos) : {};

  const savedView = localStorage.getItem('activeViewId') || 'dashboardView';
  const startTime = localStorage.getItem('shiftStartTime');

  // Switch away from the blank/login state IMMEDIATELY — never wait on a network
  // call before showing the correct screen. This is what removes the login flash.
  restoreDashboardState();

  if (savedView === 'punchInView' || savedView === 'punchOutView') {
    // Show the view right away (with its existing "Loading..." placeholder if
    // bookings aren't ready yet) instead of waiting on the fetch first.
    showView(savedView);
  } else if (savedView === 'pendingFormsView') {
    showPendingFormsView();
  } else {
    showView(savedView);
  }

  // Now fetch bookings in the background if needed, and only AFTER that,
  // populate the punch-in/out lists (radio buttons / checkboxes) in place —
  // the correct screen is already visible by this point either way.
  if (startTime && activeShiftBookings.length === 0) {
    fetchBookingsForShift(startTime, true).then(() => {
      if (savedView === 'punchInView') {
        openPunchIn(localStorage.getItem('currentPunchMode') || 'ACTIVE');
      } else if (savedView === 'punchOutView') {
        openPunchOut(localStorage.getItem('currentPunchMode') || 'ACTIVE');
      }
    }).catch(() => {
      if (savedView === 'punchInView') {
        openPunchIn(localStorage.getItem('currentPunchMode') || 'ACTIVE');
      } else if (savedView === 'punchOutView') {
        openPunchOut(localStorage.getItem('currentPunchMode') || 'ACTIVE');
      }
    });
  } else if (savedView === 'punchInView') {
    openPunchIn(localStorage.getItem('currentPunchMode') || 'ACTIVE');
  } else if (savedView === 'punchOutView') {
    openPunchOut(localStorage.getItem('currentPunchMode') || 'ACTIVE');
  }
}

// Navigation helpers
function showView(viewId) {
  activeViewId = viewId;
  const views = document.querySelectorAll('.view-panel');
  views.forEach((v) => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');

  // Control Header Back Button visibility
  const headerBackBtn = document.getElementById('headerBackBtn');
  const profileChip = document.getElementById('profileChip'); // NEW
  if (viewId === 'authView' || viewId === 'dashboardView') {
    headerBackBtn.classList.add('display-none');
    if (profileChip) profileChip.classList.remove('header-compact'); // NEW
  } else {
    headerBackBtn.classList.remove('display-none');
    if (profileChip) profileChip.classList.add('header-compact'); // NEW
  }

  // Save the current view so we stay on it after refresh
  if (viewId !== 'authView' && viewId !== 'registerView') {
    localStorage.setItem('activeViewId', viewId);
  }
}

function navigateBack() {
  if (activeViewId === 'registerView') {
    showAuthView();
  } else if ((activeViewId === 'punchInView' || activeViewId === 'punchOutView') && currentPunchMode === 'PENDING') {
    showPendingFormsView();
  } else if (activeViewId === 'submitPhotosMenuView') {
    openSubmitPhotos();
  } else if (activeViewId === 'punchInView' || activeViewId === 'punchOutView' || activeViewId === 'confirmView' || activeViewId === 'readinessWidgetView' || activeViewId === 'endShiftView' || activeViewId === 'pendingFormsView' || activeViewId === 'submitPhotosBookingSelectView') {
    showDashboardView();
  } else {
    showAuthView();
  }
}

// Shared handler for the inline "← Back to Dashboard" buttons inside Punch In/Out forms
function backFromPunchForm() {
  if (currentPunchMode === 'PENDING') {
    showPendingFormsView();
  } else {
    showDashboardView();
  }
}

function showAuthView() {
  document.getElementById('profileChip').style.display = 'none';
  showView('authView');
}

function showRegisterView() {
  document.getElementById('profileChip').style.display = 'none';
  showView('registerView');
}

function restoreDashboardState() {
  const state = localStorage.getItem('shiftState') || 'PRE_SHIFT';
  const startRow = document.getElementById('startShiftRow');
  const readinessContainer = document.getElementById('readinessActionContainer');
  const dashboardActions = document.getElementById('dashboardActions');
  const endBtn = document.getElementById('headerEndShiftBtn');

  if (state === 'PRE_SHIFT') {
    if (startRow) startRow.classList.remove('display-none');
    if (readinessContainer) readinessContainer.classList.add('display-none');
    if (dashboardActions) dashboardActions.classList.add('display-none');
    if (endBtn) endBtn.disabled = true;
  } else if (state === 'READINESS_PENDING') {
    if (startRow) startRow.classList.add('display-none');
    if (readinessContainer) readinessContainer.classList.remove('display-none');
    if (dashboardActions) dashboardActions.classList.add('display-none');
    if (endBtn) endBtn.disabled = true;

    const startTime = localStorage.getItem('shiftStartTime');
    if (startTime && activeShiftBookings.length === 0) {
      fetchBookingsForShift(startTime, true);
    }
  } else if (state === 'ACTIVE') {
    if (startRow) startRow.classList.add('display-none');
    if (readinessContainer) readinessContainer.classList.add('display-none');
    if (dashboardActions) dashboardActions.classList.remove('display-none');
    if (endBtn) endBtn.disabled = false;

    const startTime = localStorage.getItem('shiftStartTime');
    if (startTime && activeShiftBookings.length === 0) {
      fetchBookingsForShift(startTime, true);
    }
  }
}

function updateChauffeurUI() {
  if (!currentChauffeur) return;
  const capitalizedName = currentChauffeur.name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

  document.getElementById('headerChauffeurName').textContent = capitalizedName.split(' ')[0];
  document.getElementById('profileChip').style.display = 'flex';
  document.getElementById('dashChauffeurName').textContent = `Hello, ${capitalizedName}!`;

  let shiftInfoText = `Mobile Number : ${currentChauffeur.number}`;
  if (activeShiftBookings && activeShiftBookings.length > 0) {
    shiftInfoText += ` | Bookings Assigned: ${activeShiftBookings.length}`;
  }
  document.getElementById('dashShiftInfo').textContent = shiftInfoText;
}

function showDashboardView() {
  if (!currentChauffeur) return showAuthView();

  updateChauffeurUI();
  restoreDashboardState();
  updatePendingWidget();

  showView('dashboardView');
}

// ---------- PENDING FORMS LOGIC ----------
function updatePendingWidget() {
  const missedStr = localStorage.getItem('missedForms');
  const widget = document.getElementById('pendingFormsWidget');
  if (!missedStr || !widget) return;

  const missedForms = JSON.parse(missedStr);
  const missedPunchInCount = missedForms.punchIns ? missedForms.punchIns.length : 0;
  const missedPunchOutCount = missedForms.punchOuts ? missedForms.punchOuts.length : 0;
  const totalMissed = missedPunchInCount + missedPunchOutCount;

  if (totalMissed > 0) {
    widget.classList.remove('display-none');
    document.getElementById('pendingWidgetCount').textContent = totalMissed;
  } else {
    widget.classList.add('display-none');
  }
}

function showPendingFormsView() {
  document.getElementById('pendingFormsWidget').classList.add('display-none');
  const missedStr = localStorage.getItem('missedForms');
  // if (!missedStr) return;

  const missedForms = JSON.parse(missedStr);
  const missedPunchInCount = missedForms.punchIns ? missedForms.punchIns.length : 0;
  const missedPunchOutCount = missedForms.punchOuts ? missedForms.punchOuts.length : 0;

  document.getElementById('pendingPunchInCount').textContent = `${missedPunchInCount} missed`;
  document.getElementById('pendingPunchOutCount').textContent = `${missedPunchOutCount} missed`;

  const btnIn = document.getElementById('btnPendingPunchIn');
  const btnOut = document.getElementById('btnPendingPunchOut');

  btnIn.disabled = (missedPunchInCount === 0);
  btnIn.style.opacity = (missedPunchInCount === 0) ? '0.5' : '1';

  btnOut.disabled = (missedPunchOutCount === 0);
  btnOut.style.opacity = (missedPunchOutCount === 0) ? '0.5' : '1';

  showView('pendingFormsView');
}

var currentSubmitPhotosBookingId = null;

function openSubmitPhotos() {
  document.getElementById('pendingFormsWidget').classList.add('display-none');
  const radioList = document.getElementById('submitPhotosBookingRadioList');
  radioList.innerHTML = '';

  if (!activeShiftBookings || activeShiftBookings.length === 0) {
    radioList.innerHTML = '<p class="placeholder-text" style="color:#ef4444;">No assigned bookings found. Please make sure you have clicked "Start Shift" first.</p>';
    showView('submitPhotosBookingSelectView');
    return;
  }

  // NEW: hide bookings where all 3 photo types (parking, pickup, drop) are already submitted
  const remainingBookings = activeShiftBookings.filter((booking) => {
    const done = submittedPhotosLocal[booking.bookingId] || [];
    return !(done.includes('parking') && done.includes('pickup') && done.includes('drop'));
  });

  if (remainingBookings.length === 0) {
    radioList.innerHTML = '<p class="placeholder-text" style="color:#10b981;">All photos submitted for your assigned bookings.</p>';
    showView('submitPhotosBookingSelectView');
    return;
  }

  remainingBookings.forEach((booking) => {
    const bId = booking.bookingId;
    const radioItem = document.createElement('label');
    radioItem.className = 'radio-card';
    radioItem.innerHTML = `
      <input type="radio" name="selectedSubmitPhotosBooking" value="${bId}" onchange="onSubmitPhotosBookingSelect('${bId}')">
      <div class="radio-info">
        <span class="radio-title">Booking ID: ${bId}</span>
        <span class="radio-sub">Customer: ${booking.customerName}</span>
      </div>
    `;
    radioList.appendChild(radioItem);
  });

  showView('submitPhotosBookingSelectView');
}

function onSubmitPhotosBookingSelect(bookingId) {
  currentSubmitPhotosBookingId = bookingId;
  showSubmitPhotosMenuView();
}

function showSubmitPhotosMenuView() {
  document.getElementById('pendingFormsWidget').classList.add('display-none');
  document.getElementById('submitPhotosSelectedBookingLabel').textContent = currentSubmitPhotosBookingId || '';
  showView('submitPhotosMenuView');
}

// ---------- MongoDB Auth Handlers ----------
function submitRegister() {
  const name = document.getElementById('regName').value.trim();
  const number = document.getElementById('regNumber').value.trim();
  const btn = document.getElementById('btnRegisterSubmit');

  if (!name || !number) {
    alert('Please fill in both Name and Mobile Number.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating Account...';

  fetch('/api/chauffeur/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, number }),
  })
    .then((res) => res.json().then((data) => ({ status: res.status, data })))
    .then(({ status, data }) => {
      btn.disabled = false;
      btn.textContent = 'Create Account';

      if (status !== 200 || data.error) {
        alert(data.error || 'Registration failed.');
        return;
      }

      alert(data.message || 'Account created successfully!');
      document.getElementById('registerForm').reset();
      showAuthView();
    })
    .catch((err) => {
      btn.disabled = false;
      btn.textContent = 'Create Account';
      alert('Error creating account: ' + err.message);
    });
}

function submitLogin() {
  const name = document.getElementById('loginName').value.trim();
  const number = document.getElementById('loginNumber').value.trim();
  const btn = document.getElementById('btnLoginSubmit');

  if (!name || !number) {
    alert('Please enter Name, Mobile Number.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Logging In...';

  fetch('/api/chauffeur/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, number }),
  })
    .then((res) => res.json().then((data) => ({ status: res.status, data })))
    .then(({ status, data }) => {
      btn.disabled = false;
      btn.textContent = 'Log In';

      if (status !== 200 || data.error) {
        alert(data.error || 'Login failed. Please check credentials or create an account.');
        return;
      }

      // Save profile permanently on the device
      localStorage.setItem('chauffeur', JSON.stringify(data.chauffeur));
      currentChauffeur = data.chauffeur;
      showDashboardView();
    })
    .catch((err) => {
      btn.disabled = false;
      btn.textContent = 'Log In';
      alert('Error during log in: ' + err.message);
    });
}

function handleLogout() {
  if (confirm("Are you sure you want to log out?")) {
    localStorage.removeItem('chauffeur');
    localStorage.removeItem('shiftState');
    localStorage.removeItem('shiftStartTime');
    localStorage.removeItem('currentPunchMode');
    localStorage.removeItem('completedBookingsLocal');
    localStorage.removeItem('punchedInBookingsLocal');
    localStorage.removeItem('submittedPhotosLocal');
    stopShiftWatcher();
    currentChauffeur = null;
    showAuthView();
  }
}


async function handleStartShift() {
  const confirmed = await showCustomConfirm("Are you sure you want to start shift?");
  if (!confirmed) {
    return;
  }

  // Capture exact moment they click Start Shift and fetch bookings immediately
  const clientTimestamp = new Date().toLocaleString('en-US', { hour12: true });
  localStorage.setItem('shiftStartTime', clientTimestamp);

  localStorage.setItem('shiftState', 'READINESS_PENDING');
  restoreDashboardState();

  // Fetch bookings so user sees they are loaded while doing the checklist
  fetchBookingsForShift(clientTimestamp);
}

function openReadinessChecklist() {
  document.getElementById('readinessForm').reset();
  document.getElementById('pendingFormsWidget').classList.add('display-none');
  document.getElementById('readinessPhotoBtnText').textContent = "📷 Click Photo";

  readinessPhotosArray = []; // NEW: clear any previously captured photos
  renderReadinessPhotoThumbs(); // NEW: reset thumbnail list & status text

  const submitBtn = document.getElementById('btnReadinessSubmit');
  if (submitBtn) submitBtn.disabled = true;

  showView('readinessWidgetView');
}

async function submitVehicleReadiness() {
  if (readinessPhotosArray.length === 0) {
    alert('Please capture at least one photo of the cleaned vehicle.');
    return;
  }

  if (!allCheckboxesChecked('vrClean')) {
    alert('Please check ALL options under "Is vehicle clean?".');
    return;
  }
  if (!allCheckboxesChecked('vrAmenities')) {
    alert('Please check ALL options under "Are amenities ready?".');
    return;
  }
  if (!allCheckboxesChecked('vrReady')) {
    alert('Please check ALL options under "Are you ready?".');
    return;
  }

  const getCheckedValues = (name) => {
    return Array.from(document.querySelectorAll(`input[name="${name}"]:checked`))
      .map(cb => cb.value).join(', ');
  };

  const vrClean = getCheckedValues('vrClean');
  const vrAmenities = getCheckedValues('vrAmenities');
  const vrReady = getCheckedValues('vrReady');

  const clientTimestamp = localStorage.getItem('shiftStartTime') || new Date().toLocaleString('en-US', { hour12: true });
  const readinessBtn = document.getElementById('btnReadinessSubmit');

  readinessBtn.disabled = true;
  readinessBtn.textContent = 'Compressing Photos...';

  try {
    const formData = new FormData();

    for (let i = 0; i < readinessPhotosArray.length; i++) {
      const originalFile = readinessPhotosArray[i];
      const compressedBlob = await compressImage(originalFile, { quality: 0.6, maxWidth: 1200, maxHeight: 1200 });
      formData.append('readinessImages', compressedBlob, originalFile.name || `readiness_${i + 1}.jpg`);
    }

    readinessBtn.textContent = 'Starting Shift...';

    formData.append('clientTimestamp', clientTimestamp);
    formData.append('chauffeur', JSON.stringify(currentChauffeur));
    formData.append('vrClean', vrClean);
    formData.append('vrAmenities', vrAmenities);
    formData.append('vrReady', vrReady);
    formData.append('assignedBookings', JSON.stringify(activeShiftBookings));

    const res = await fetch('/api/shift/start', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    readinessBtn.disabled = false;
    readinessBtn.textContent = 'Submit & Start Shift';

    if (!res.ok || data.error) {
      alert('Shift start error: ' + (data.error || 'Unknown error'));
      return;
    }

    localStorage.setItem('shiftState', 'ACTIVE');
    localStorage.setItem('firstPunchInDone', 'false');
    localStorage.setItem('firstPunchOutDone', 'false');

    if (data.shiftRowIndex) {
      localStorage.setItem('shiftRowIndex', data.shiftRowIndex);
    }

    document.getElementById('dashShiftInfo').textContent = `Mobile Number : ${currentChauffeur.number} | Bookings : ${activeShiftBookings.length}`;
    showDashboardView();
  } catch (err) {
    readinessBtn.disabled = false;
    readinessBtn.textContent = 'Submit & Start Shift';
    alert('Failed to start shift: ' + err.message);
  }
}

function handleEndShift() {
  document.getElementById('endShiftForm').reset();
  document.getElementById('readinessPhotoBtnText').textContent = "📷 Click Photo";

  // Reset the custom photo UI
  const statusText = document.getElementById('photoStatusText');
  const submitBtn = document.getElementById('btnEndShiftSubmit');
  if (statusText) {
    statusText.textContent = "No photo captured yet";
    statusText.style.color = "#ef4444";
  }
  if (submitBtn) {
    submitBtn.disabled = true;
  }

  showView('endShiftView');
}

function handleReadinessPhotoCapture(event) {
  const input = event.target;
  if (input.files && input.files.length > 0) {
    readinessPhotosArray.push(input.files[0]);
    renderReadinessPhotoThumbs();
  }
  input.value = ''; // reset so the next click always fires a fresh change event (lets them capture again)
  updateReadinessSubmitState();
}

function renderReadinessPhotoThumbs() {
  const container = document.getElementById('readinessPhotoThumbList');
  const statusText = document.getElementById('readinessPhotoStatusText');
  const btnText = document.getElementById('readinessPhotoBtnText');

  container.innerHTML = '';

  if (readinessPhotosArray.length === 0) {
    statusText.textContent = "No photo captured yet";
    statusText.style.color = "#ef4444";
    btnText.textContent = "📷 Click Photo";
    return;
  }

  statusText.textContent = `✅ ${readinessPhotosArray.length} photo(s) captured`;
  statusText.style.color = "#10b981";
  btnText.textContent = "📷 Add Another Photo";

  readinessPhotosArray.forEach((file, index) => {
    const url = URL.createObjectURL(file);
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'photo-thumb-item';
    thumbWrap.innerHTML = `
      <img src="${url}" class="photo-thumb-img" />
      <span class="photo-thumb-remove" onclick="removeReadinessPhoto(${index})">✕</span>
    `;
    container.appendChild(thumbWrap);
  });
}

function removeReadinessPhoto(index) {
  readinessPhotosArray.splice(index, 1);
  renderReadinessPhotoThumbs();
  updateReadinessSubmitState();
}

function allCheckboxesChecked(name) {
  const boxes = document.querySelectorAll(`input[name="${name}"]`);
  return boxes.length > 0 && Array.from(boxes).every(cb => cb.checked);
}

function updateReadinessSubmitState() {
  const submitBtn = document.getElementById('btnReadinessSubmit');
  if (!submitBtn) return;

  const cleanOk = allCheckboxesChecked('vrClean');
  const amenitiesOk = allCheckboxesChecked('vrAmenities');
  const readyOk = allCheckboxesChecked('vrReady');
  const photoOk = readinessPhotosArray.length > 0;

  submitBtn.disabled = !(cleanOk && amenitiesOk && readyOk && photoOk);
}

function updatePhotoStatus() {
  const fileInput = document.getElementById('endShiftImage');
  const statusText = document.getElementById('photoStatusText');
  const submitBtn = document.getElementById('btnEndShiftSubmit');
  const btnText = document.getElementById('endShiftPhotoBtnText');

  if (fileInput.files && fileInput.files.length > 0) {
    statusText.textContent = "✅ Photo captured successfully!";
    statusText.style.color = "#10b981";
    submitBtn.disabled = false;
    btnText.textContent = "🔄 Retake";
  } else {
    statusText.textContent = "No photo captured yet";
    statusText.style.color = "#ef4444";
    submitBtn.disabled = true;
    btnText.textContent = "📷 Click Photo";
  }
}

function compressImage(file, { quality = 0.7, maxWidth = 1200, maxHeight = 1200 }) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          resolve(blob);
        }, 'image/jpeg', quality);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

function triggerTripPhotoCapture(type) {
  const inputId = 'tripPhotoInput' + type.charAt(0).toUpperCase() + type.slice(1);
  document.getElementById(inputId).click();
}

async function handleTripPhotoSelected(event, type) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const toast = document.getElementById('tripPhotoToast');
  clearTimeout(window._tripPhotoToastTimer);

  // NEW: show "Uploading..." immediately
  toast.textContent = '⏳ Uploading...';
  toast.classList.remove('display-none');

  try {
    const compressedBlob = await compressImage(file, { quality: 0.6, maxWidth: 1200, maxHeight: 1200 });

    const formData = new FormData();
    formData.append('image', compressedBlob, file.name || 'photo.jpg');
    formData.append('photoType', type);
    formData.append('bookingId', currentSubmitPhotosBookingId || '');
    formData.append('chauffeurName', currentChauffeur.name);
    formData.append('chauffeurNumber', currentChauffeur.number);

    const res = await fetch('/api/trip-photo/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok || data.error) {
      toast.classList.add('display-none'); // NEW: hide "Uploading..." on failure
      alert('Upload failed: ' + (data.error || 'Unknown error'));
      return;
    }

    // Track that this photo type is done for this booking (same as before)
    if (!submittedPhotosLocal[currentSubmitPhotosBookingId]) {
      submittedPhotosLocal[currentSubmitPhotosBookingId] = [];
    }
    if (!submittedPhotosLocal[currentSubmitPhotosBookingId].includes(type)) {
      submittedPhotosLocal[currentSubmitPhotosBookingId].push(type);
    }
    localStorage.setItem('submittedPhotosLocal', JSON.stringify(submittedPhotosLocal));

    toast.textContent = '✅ Photo successfully captured!';
    toast.classList.remove('display-none');
    clearTimeout(window._tripPhotoToastTimer);
    window._tripPhotoToastTimer = setTimeout(() => toast.classList.add('display-none'), 3000);
  } catch (err) {
    toast.classList.add('display-none'); // NEW: hide "Uploading..." on error
    alert('Failed to submit photo: ' + err.message);
  } finally {
    event.target.value = ''; // reset so the same photo type can be captured again if needed
  }
}

async function submitEndShift() {
  if (isEndingShift) {
    alert('Your shift is already being ended. Please wait.');
    return;
  }
  isEndingShift = true;

  const fileInput = document.getElementById('endShiftImage');
  if (!fileInput.files || fileInput.files.length === 0) {
    alert('Please capture a photo of the odometer.');
    isEndingShift = false;
    return;
  }

  const options = { month: 'numeric', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true };
  const clientTimestamp = new Date().toLocaleString('en-US', options);
  const startBtn = document.getElementById('btnStartShift');
  const btnSubmit = document.getElementById('btnEndShiftSubmit');

  btnSubmit.disabled = true;
  btnSubmit.textContent = 'Compressing Photo...';

  try {
    const originalFile = fileInput.files[0];
    const compressedBlob = await compressImage(originalFile, { quality: 0.6, maxWidth: 1200, maxHeight: 1200 });

    btnSubmit.textContent = 'Uploading...';

    const formData = new FormData();
    formData.append('image', compressedBlob, originalFile.name || 'photo.jpg');
    formData.append('clientTimestamp', clientTimestamp);
    formData.append('chauffeurName', currentChauffeur.name);
    formData.append('chauffeurNumber', currentChauffeur.number);
    const shiftRowIndex = localStorage.getItem('shiftRowIndex');
    if (shiftRowIndex) formData.append('shiftRowIndex', shiftRowIndex);

    const res = await fetch('/api/shift/end', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Server returned ${res.status}: ${text.substring(0, 100)}`);
    }

    const data = await res.json();

    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Submit & End Shift';
    startBtn.disabled = false;

    finalizeShiftEnd(false);
  } catch (err) {
    console.error(err);
    btnSubmit.disabled = false;
    btnSubmit.textContent = 'Submit & End Shift';
    isEndingShift = false;
    alert('Failed to end shift: ' + err.message);
  }
}

var bookingsFetchInFlight = null;

function fetchBookingsForShift(shiftStartTimeStr, silent = false) {
  if (bookingsFetchInFlight) return bookingsFetchInFlight; // reuse the in-flight request instead of firing a duplicate

  bookingsFetchInFlight = fetch(`/api/bookings/shift-window?startTime=${encodeURIComponent(shiftStartTimeStr)}&name=${encodeURIComponent(currentChauffeur.name)}`)
    .then(res => res.json().then(data => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      if (!ok) {
        console.error('Shift window error:', data.error);
        if (!silent) alert(data.error || 'Could not load bookings. Please try again.');
        return;
      }
      activeShiftBookings = data.bookings || [];

      const dashShiftInfo = document.getElementById('dashShiftInfo');
      if (dashShiftInfo && currentChauffeur) {
        dashShiftInfo.textContent = `Mobile Number : ${currentChauffeur.number} | Bookings : ${activeShiftBookings.length}`;
      }
    })
    .catch(err => console.error('Error fetching shift bookings:', err))
    .finally(() => { bookingsFetchInFlight = null; });

  return bookingsFetchInFlight;
}

// ---------- PUNCH IN WORKFLOW (RADIO BUTTONS) ----------
function openPunchIn(mode = 'ACTIVE') {
  currentPunchMode = mode;
  localStorage.setItem('currentPunchMode', mode);
  document.getElementById('pendingFormsWidget').classList.add('display-none');
  const radioList = document.getElementById('punchInBookingsRadioList');
  const preShiftSec = document.getElementById('preShiftFormSection');

  radioList.innerHTML = '';
  preShiftSec.classList.add('display-none');
  document.getElementById('punchInForm').reset();

  showView('punchInView');

  let sourceBookings = [];
  if (mode === 'PENDING') {
    const missedStr = localStorage.getItem('missedForms');
    if (missedStr) {
      const missedForms = JSON.parse(missedStr);
      sourceBookings = missedForms.punchIns || [];
    }

    if (sourceBookings.length === 0) {
      radioList.innerHTML = '<p class="placeholder-text" style="color:#10b981;">No pending Punch Ins found.</p>';
      return;
    }
  } else {
    // Verify shift has been started
    if (activeShiftBookings.length === 0) {
      radioList.innerHTML = '<p class="placeholder-text" style="color:#ef4444;">No assigned bookings found. Please make sure you have clicked "Start Shift" first.</p>';
      return;
    }

    // Filter out bookings that have already been punched in
    sourceBookings = activeShiftBookings.filter(b => !punchedInBookingsLocal.includes(b.bookingId));

    if (sourceBookings.length === 0) {
      radioList.innerHTML = '<p class="placeholder-text" style="color:#10b981;">All your assigned bookings have already been punched in.</p>';
      return;
    }
  }

  // Render radio buttons directly from sourceBookings
  sourceBookings.forEach((booking) => {
    const bId = booking.bookingId;
    const radioItem = document.createElement('label');
    radioItem.className = 'radio-card';
    radioItem.innerHTML = `
      <input type="radio" name="selectedPunchInBooking" value="${bId}" onchange="onPunchInRadioSelect('${bId}')">
      <div class="radio-info">
        <span class="radio-title">Booking ID: ${bId}</span>
        <span class="radio-sub">Customer: ${booking.customerName}</span>
      </div>
    `;
    radioList.appendChild(radioItem);
  });
}

function onPunchInRadioSelect(selectedBookingId) {
  const preShiftSec = document.getElementById('preShiftFormSection');
  preShiftSec.classList.remove('display-none');
}

function submitPunchIn() {
  const selectedRadio = document.querySelector('input[name="selectedPunchInBooking"]:checked');
  if (!selectedRadio) {
    alert('Please select a Booking ID radio button for Punch In.');
    return;
  }

  const bookingId = selectedRadio.value;
  const carCleaned = document.getElementById('carCleaned').value;
  const phoneCharged = document.getElementById('phoneCharged').value;
  const enoughPetrol = document.getElementById('enoughPetrol').value;
  const btn = document.getElementById('btnPunchInSubmit');

  if (!carCleaned || !phoneCharged || !enoughPetrol) {
    alert('Please answer all pre-ride checklist questions.');
    return;
  }

  // Get current local time on the chauffeur's phone
  const clientTimestamp = new Date().toLocaleString('en-US', { hour12: true });

  btn.disabled = true;
  btn.textContent = 'Submitting Punch In...';

  fetch('/api/punch-in', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookingId, carCleaned, phoneCharged, enoughPetrol, clientTimestamp, chauffeur: currentChauffeur
    }),
  })
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      btn.disabled = false;
      btn.textContent = 'Confirm Punch In';

      if (!ok || data.error) {
        alert('Punch In error: ' + (data.error || 'Unknown error'));
        return;
      }

      localStorage.setItem('firstPunchInDone', 'true');

      if (currentPunchMode === 'PENDING') {
        const missedStr = localStorage.getItem('missedForms');
        if (missedStr) {
          const missedForms = JSON.parse(missedStr);
          if (missedForms.punchIns) {
            missedForms.punchIns = missedForms.punchIns.filter(b => b.bookingId !== bookingId);
            localStorage.setItem('missedForms', JSON.stringify(missedForms));
          }
        }
        updatePendingWidget();
      } else {
        if (!punchedInBookingsLocal.includes(bookingId)) {
          punchedInBookingsLocal.push(bookingId);
          localStorage.setItem('punchedInBookingsLocal', JSON.stringify(punchedInBookingsLocal));
        }
      }

      document.getElementById('confirmTitle').textContent = 'Punch In Successful!';
      document.getElementById('confirmMessage').textContent = `Pre-ride checklist for Booking ID ${bookingId} has been recorded`;
      showView('confirmView');
    })
    .catch((err) => {
      btn.disabled = false;
      btn.textContent = 'Confirm Punch In';
      alert('Punch In error: ' + err.message);
    });
}

// ---------- PUNCH OUT WORKFLOW (CHECKBOXES + DYNAMIC RIDE REPORTS) ----------
function openPunchOut(mode = 'ACTIVE') {
  currentPunchMode = mode;
  localStorage.setItem('currentPunchMode', mode);
  document.getElementById('pendingFormsWidget').classList.add('display-none');
  const checkboxList = document.getElementById('pendingBookingsCheckboxList');
  const reportsContainer = document.getElementById('dynamicRideReportsContainer');
  const actionsBlock = document.getElementById('punchOutActions');

  checkboxList.innerHTML = '';
  reportsContainer.innerHTML = '';
  actionsBlock.classList.add('display-none');
  document.getElementById('punchOutForm').reset();

  showView('punchOutView');

  let pending = [];
  if (mode === 'PENDING') {
    const missedStr = localStorage.getItem('missedForms');
    if (missedStr) {
      const missedForms = JSON.parse(missedStr);
      pending = missedForms.punchOuts || [];
    }

    if (pending.length === 0) {
      checkboxList.innerHTML = '<p class="placeholder-text" style="color:#10b981;">No pending Punch Outs found.</p>';
      return;
    }
  } else {
    // Filter out bookings that have already been submitted (punched out)
    pending = activeShiftBookings.filter(b => !completedBookingsLocal.includes(b.bookingId));

    if (pending.length === 0) {
      checkboxList.innerHTML = '<p class="placeholder-text" style="color:#10b981;">No pending rides found! All shift rides have been completed.</p>';
      return;
    }
  }

  // Populate pendingBookingsData for dynamic form name rendering
  pendingBookingsData = pending;

  // Render checkboxes directly from the filtered pending list
  pending.forEach((booking) => {
    const bId = booking.bookingId;
    const checkItem = document.createElement('label');
    checkItem.className = 'checkbox-card';
    checkItem.innerHTML = `
      <input type="checkbox" name="pendingBookingCheck" value="${bId}" onchange="renderDynamicRideReports()">
      <div class="checkbox-info">
        <span class="checkbox-title">Booking ID: ${bId}</span>
        <span class="checkbox-sub">Customer: ${booking.customerName}</span>
      </div>
    `;
    checkboxList.appendChild(checkItem);
  });
}

function renderDynamicRideReports() {
  const checkedBoxes = document.querySelectorAll('input[name="pendingBookingCheck"]:checked');
  const container = document.getElementById('dynamicRideReportsContainer');
  const actionsBlock = document.getElementById('punchOutActions');

  container.innerHTML = '';

  if (checkedBoxes.length === 0) {
    actionsBlock.classList.add('display-none');
    return;
  }

  checkedBoxes.forEach((cb) => {
    const bookingId = cb.value;
    const formCard = document.createElement('div');
    formCard.className = 'booking-form-card';
    formCard.setAttribute('data-booking-id', bookingId);

    formCard.innerHTML = `
      <div class="booking-form-title">Ride Completion Report – Booking: ${bookingId}</div>
      
      <div class="form-group">
        <label>Ride status</label>
        <select name="status_${bookingId}" required>
          <option value="">-- Choose Status --</option>
          <option value="Completed">Completed</option>
          <option value="Cancelled">Cancelled</option>
          <option value="No show">No show</option>
        </select>
      </div>

      <div class="form-group">
        <label>Were the guest details correct?</label>
        <select name="guestDetails_${bookingId}" required>
          <option value="">-- Choose --</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </div>

      <div class="form-group">
        <label>Were the luggage details correct?</label>
        <select name="luggageDetails_${bookingId}" required>
          <option value="">-- Choose --</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </div>

      <div class="form-group">
        <label>Any operational issue or mismatch?</label>
        <select name="operationalIssues_${bookingId}" required>
          <option value="">-- Choose --</option>
          <option value="No Issues">No Issues</option>
          <option value="Issue Reported">Issue Reported</option>
        </select>
      </div>

      <div class="form-group">
        <label>Operational Issue Checkbox(es):</label>
        <div class="checkbox-group">
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Wrong guest number / No response"> Wrong guest number / No response</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Customer requesting for different drop/pickup"> Customer requesting for different drop/pickup</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Flight delayed"> Flight delayed</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Flight preponed"> Flight preponed</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Parking issue"> Parking issue</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Luggage mismatch"> Luggage mismatch</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Guest requested another vehicle type"> Guest requested another vehicle type</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Vehicle breakdown"> Vehicle breakdown</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Guest complained about foul smell or unclean vehicle"> Guest complained about foul smell or unclean vehicle</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Rude passenger"> Rude passenger</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Ride missed"> Ride missed</label>
          <label class="checkbox-label"><input type="checkbox" name="issues_${bookingId}" value="Delay in pickup"> Delay in pickup</label>
          <label class="checkbox-label">
            <input type="checkbox" id="otherCheck_${bookingId}" name="issues_${bookingId}" value="Other" onchange="toggleOtherTextDynamic('${bookingId}')">
            <span>Other:</span>
          </label>
          <input type="text" id="otherText_${bookingId}" name="otherText_${bookingId}" class="display-none" placeholder="Please specify issue...">
        </div>
      </div>

      <div class="form-group">
        <label>Issue Description</label>
        <textarea name="issueDescription_${bookingId}" rows="2" placeholder="Additional details..."></textarea>
      </div>

      <div class="form-group">
        <label>Guest Feedback Option</label>
        <select name="guestFeedbackOptions_${bookingId}" required>
          <option value="">-- Choose --</option>
          <option value="Positive">Positive</option>
          <option value="Neutral">Neutral</option>
          <option value="Negetive">Negetive</option>
          <option value="No Feedback">No Feedback</option>
        </select>
      </div>

      <div class="form-group">
        <label>Guest Feedback Text</label>
        <input type="text" name="guestFeedbackText_${bookingId}" placeholder="Guest feedback notes...">
      </div>

      <div class="form-group">
        <label>Additional Remarks</label>
        <textarea name="remarks_${bookingId}" rows="2" placeholder="Extra remarks..."></textarea>
      </div>
    `;

    container.appendChild(formCard);
  });

  actionsBlock.classList.remove('display-none');
}

function toggleOtherTextDynamic(bookingId) {
  const checkBox = document.getElementById("otherCheck_" + bookingId);
  const textBox = document.getElementById("otherText_" + bookingId);
  if (checkBox.checked) {
    textBox.classList.remove("display-none");
    textBox.required = true;
    textBox.focus();
  } else {
    textBox.classList.add("display-none");
    textBox.required = false;
    textBox.value = "";
  }
}

function submitPunchOut() {
  const checkedBoxes = document.querySelectorAll('input[name="pendingBookingCheck"]:checked');
  if (checkedBoxes.length === 0) {
    alert('Please select at least one pending Booking ID.');
    return;
  }

  // NEW: Block submission if Punch In hasn't been completed for any selected booking
  const missedStr = localStorage.getItem('missedForms');
  const missedForms = missedStr ? JSON.parse(missedStr) : { punchIns: [], punchOuts: [] };
  const missedPunchInIds = (missedForms.punchIns || []).map(b => b.bookingId);

  for (const cb of checkedBoxes) {
    const bookingId = cb.value;
    const punchInDone = currentPunchMode === 'PENDING'
      ? !missedPunchInIds.includes(bookingId)
      : punchedInBookingsLocal.includes(bookingId);

    if (!punchInDone) {
      alert(`Please fill the Punch In form for Booking ID ${bookingId} first.`);
      return;
    }
  }

  const reports = [];
  let isValid = true;

  checkedBoxes.forEach((cb) => {
    const bookingId = cb.value;
    const card = document.querySelector(`.booking-form-card[data-booking-id="${bookingId}"]`);

    if (!card) return;

    const status = card.querySelector(`[name="status_${bookingId}"]`).value;
    const matchedBooking = pendingBookingsData.find(b => b.bookingId === bookingId);
    const customerName = matchedBooking ? matchedBooking.customerName : 'Unknown Customer';
    const guestDetails = card.querySelector(`[name="guestDetails_${bookingId}"]`).value;
    const luggageDetails = card.querySelector(`[name="luggageDetails_${bookingId}"]`).value;
    const operationalIssues = card.querySelector(`[name="operationalIssues_${bookingId}"]`).value;
    const guestFeedbackOptions = card.querySelector(`[name="guestFeedbackOptions_${bookingId}"]`).value;

    if (!status || !customerName || !guestDetails || !luggageDetails || !operationalIssues || !guestFeedbackOptions) {
      isValid = false;
    }

    const issueCheckboxes = card.querySelectorAll(`input[name="issues_${bookingId}"]:checked`);
    const issuesArray = [];
    issueCheckboxes.forEach((icb) => {
      if (icb.value === 'Other') {
        const textInput = card.querySelector(`input[name="otherText_${bookingId}"]`);
        if (textInput && textInput.value) {
          issuesArray.push('Other: ' + textInput.value);
        } else {
          issuesArray.push('Other');
        }
      } else {
        issuesArray.push(icb.value);
      }
    });

    reports.push({
      bookingId,
      status,
      customerName,
      guestDetails,
      luggageDetails,
      operationalIssues,
      checkboxAnswers: issuesArray.length > 0 ? issuesArray.join(', ') : 'None',
      issueDescription: card.querySelector(`[name="issueDescription_${bookingId}"]`).value,
      guestFeedbackOptions,
      guestFeedbackText: card.querySelector(`[name="guestFeedbackText_${bookingId}"]`).value,
      remarks: card.querySelector(`[name="remarks_${bookingId}"]`).value,
    });
  });

  if (!isValid) {
    alert('Please fill out all required fields for each selected booking report.');
    return;
  }

  // Get current local time on the chauffeur's phone
  const clientTimestamp = new Date().toLocaleString('en-US', { hour12: true });

  const btn = document.getElementById('btnPunchOutSubmit');
  btn.disabled = true;
  btn.textContent = 'Submitting Punch Out...';

  fetch('/api/punch-out', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bookings: reports, clientTimestamp, chauffeur: currentChauffeur
    }),
  })
    .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
    .then(({ ok, data }) => {
      btn.disabled = false;
      btn.textContent = 'Submit Punch Out Report';

      if (!ok || data.error) {
        alert('Punch Out error: ' + (data.error || 'Unknown error'));
        return;
      }

      localStorage.setItem('firstPunchOutDone', 'true');

      if (currentPunchMode === 'PENDING') {
        const missedStr = localStorage.getItem('missedForms');
        if (missedStr) {
          const missedForms = JSON.parse(missedStr);
          if (missedForms.punchOuts) {
            const submittedIds = reports.map(r => r.bookingId);
            missedForms.punchOuts = missedForms.punchOuts.filter(b => !submittedIds.includes(b.bookingId));
            localStorage.setItem('missedForms', JSON.stringify(missedForms));
          }
        }
        updatePendingWidget();
      } else {
        // Add successfully submitted bookings to the completed local tracker
        reports.forEach(r => {
          if (!completedBookingsLocal.includes(r.bookingId)) {
            completedBookingsLocal.push(r.bookingId);
          }
        });
        localStorage.setItem('completedBookingsLocal', JSON.stringify(completedBookingsLocal));
      }

      document.getElementById('confirmTitle').textContent = 'Punch Out Completed!';
      document.getElementById('confirmMessage').textContent = `${reports.length} ride completion report(s) successfully recorded.`;
      showView('confirmView');
    })
    .catch((err) => {
      btn.disabled = false;
      btn.textContent = 'Submit Punch Out Report';
      alert('Punch Out error: ' + err.message);
    });
}

