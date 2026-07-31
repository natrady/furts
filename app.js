const DB_NAME = 'RegistroTerritorialDB';
const STORE_NAME = 'pendientes';
let db;

// 1. Inicializar IndexedDB
const request = indexedDB.open(DB_NAME, 1);
request.onupgradeneeded = e => {
  db = e.target.result;
  db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
};
request.onsuccess = e => { db = e.target.result; updatePendingCount(); };

// 2. Validaciones Globales de Inputs (Mayúsculas, sin acentos, sin símbolos)
document.addEventListener('input', e => {
  if (e.target.matches('input[type="text"], textarea')) {
    let val = e.target.value;
    val = val.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Quitar acentos
    val = val.replace(/[^a-zA-Z0-9\s]/g, ""); // Quitar caracteres especiales
    e.target.value = val.toUpperCase();
  }
});

// 3. Compresión asíncrona de Imágenes a Base64
async function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const MAX_WIDTH = 800; // Ajusta según necesites
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.6)); // 60% calidad
      };
    };
  });
}

// 4. Manejo de inputs file y Badges dinámicos
document.querySelectorAll('input[type="file"]').forEach(input => {
  input.addEventListener('change', async async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const badge = document.getElementById(`badge-${e.target.id}`);
    badge.textContent = '⏳ Comprimiendo...';
    badge.className = 'badge bg-warning text-dark mt-1';
    
    const base64 = await compressImage(file);
    e.target.dataset.base64 = base64; // Guardamos el string en el dataset del input
    
    badge.textContent = navigator.onLine ? '✅ Listo para enviar' : '💾 Se guardará offline';
    badge.className = 'badge bg-success mt-1';
  });
});

// 5. Geolocalización
async function getGeo() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) resolve("Sin GPS");
    navigator.geolocation.getCurrentPosition(
      pos => resolve(`${pos.coords.latitude}, ${pos.coords.longitude}`),
      err => resolve("Permiso denegado")
    );
  });
}

// 6. Manejador de Envíos y Modo Offline
async function submitForm(formElement, formType) {
  const formData = new FormData(formElement);
  const payload = { formType: formType, fields: {}, images: {} };

  // Recolectar textos
  for (let [key, value] of formData.entries()) {
    if (typeof value === 'string') payload.fields[key] = value;
  }
  
  // Recolectar geolocalización
  payload.fields['Geolocalizacion'] = await getGeo();

  // Recolectar imágenes procesadas
  formElement.querySelectorAll('input[type="file"]').forEach(input => {
    if (input.dataset.base64) payload.images[input.name] = input.dataset.base64;
  });

  try {
    // Intentamos el envío primario
    const response = await fetch('TU_URL_DE_APPS_SCRIPT', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error('Network response was not ok');
    alert("¡Registro enviado al servidor con éxito!");
    formElement.reset();
    
  } catch (error) {
    // Falla la red: guardamos en IndexedDB
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(payload);
    tx.oncomplete = () => {
      updatePendingCount();
      alert("Sin conexión. Registro guardado localmente 💾");
      formElement.reset();
    };
  }
}

// 7. Sincronizador en background
function updatePendingCount() {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).count();
  req.onsuccess = () => {
    const count = req.result;
    document.getElementById('sync-counter').textContent = `Pendientes: ${count}`;
    if (count > 0 && navigator.onLine) attemptSync();
  };
}

async function attemptSync() {
  // Lógica iterativa para leer registros de IndexedDB, enviarlos vía fetch()
  // y eliminarlos del objectStore si el servidor responde 200.
}

window.addEventListener('online', updatePendingCount);
