// 0. Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js')
    .then(() => console.log('Motor offline encendido 🚀'))
    .catch(err => console.error('Falla en Service Worker:', err));
}

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

// 2. Validaciones Globales de Inputs
// OJO: reasignar .value en CADA tecla (aunque el texto no cambie) hace que el
// cursor salte siempre al final del campo. En campos largos (como la CURP)
// esto "confunde" al navegador: cada letra que escribes en medio del texto
// se mueve al final, dando la sensación de que no te deja escribir bien.
// Por eso ahora sólo tocamos .value si el texto realmente cambió, y
// reposicionamos el cursor donde el usuario iba escribiendo.
document.addEventListener('input', e => {
  if (e.target.matches('input[type="text"], textarea')) {
    const original = e.target.value;
    let val = original;
    val = val.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // Quitar acentos
    val = val.replace(/[^a-zA-Z0-9\s]/g, ""); // Quitar especiales
    val = val.toUpperCase();

    if (val !== original) {
      const start = e.target.selectionStart;
      const end = e.target.selectionEnd;
      const diff = val.length - original.length;
      e.target.value = val;
      if (typeof start === 'number' && e.target.setSelectionRange) {
        e.target.setSelectionRange(Math.max(0, start + diff), Math.max(0, end + diff));
      }
    }
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
        const MAX_WIDTH = 800;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
    };
  });
}

// 4. Badges dinámicos para fotos
document.querySelectorAll('input[type="file"]').forEach(input => {
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const badge = document.getElementById(`badge-${e.target.id}`);
    badge.textContent = '⏳ Comprimiendo...';
    badge.className = 'badge bg-warning text-dark mt-1';
    
    const base64 = await compressImage(file);
    e.target.dataset.base64 = base64; 
    
    badge.textContent = navigator.onLine ? '✅ Listo' : '💾 Offline';
    badge.className = 'badge bg-success mt-1';
  });
});

// 5. Envíos y Modo Offline
async function submitForm(formElement, formType) {
  const formData = new FormData(formElement);
  const btnSubmit = document.getElementById('btnSubmit');
  const loadingOverlay = document.getElementById('loadingOverlay');
  if (btnSubmit) { btnSubmit.disabled = true; }
  if (loadingOverlay) { loadingOverlay.classList.remove('d-none'); }

  const payload = { formType: formType, fields: {}, images: {} };
  for (let [key, value] of formData.entries()) {
    if (typeof value === 'string') payload.fields[key] = value;
  }
  
  // Agregamos el Timestamp exacto de JS
  payload.fields['Timestamp'] = new Date().toLocaleString('es-MX');

  formElement.querySelectorAll('input[type="file"]').forEach(input => {
    if (input.dataset.base64) payload.images[input.name] = input.dataset.base64;
  });

  try {
    const response = await fetch('https://script.google.com/macros/s/AKfycby7kqN1YCUbgjA_RJHpsMkQmo4IsTZeC2pXElzAkvwYGvaz2iUuNIQbT2_f7oCpkxCV/exec', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    const data = await response.json();
    
    // Si Google nos manda un error interno, lo mostramos y detenemos todo
    if (data.status === 'error') {
        alert("❌ El servidor respondió, pero falló internamente: " + data.message);
        return; 
    }

    if (!response.ok) throw new Error('Network error');
    
    alert("✅ ¡Registro guardado en Sheets y Drive con éxito!");
    formElement.reset();
    
  sessionStorage.removeItem('borrador_' + formElement.id); // Borramos el borrador
    if (loadingOverlay) { loadingOverlay.classList.add('d-none'); }
    if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '💾 Guardar Registro'; }
  } catch (error) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add(payload);
    tx.oncomplete = () => {
      updatePendingCount();
      alert("Sin conexión. Registro guardado localmente 💾");
      formElement.reset();
      sessionStorage.removeItem('borrador_' + formElement.id); // Borramos el borrador
      if (loadingOverlay) { loadingOverlay.classList.add('d-none'); }
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = '💾 Guardar Registro'; }
    };
  }
}
// 6. Contador y Sincronizador
function updatePendingCount() {
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).count();
  req.onsuccess = () => {
    const count = req.result;
    document.getElementById('sync-counter').textContent = `Pendientes: ${count}`;
  };
}
// 7. Sincronizar manualmente los pendientes
async function syncPending() {
  if (!navigator.onLine) {
    alert("❌ Necesitas conexión a internet para sincronizar.");
    return;
  }

  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).getAll();

  req.onsuccess = async () => {
    const registros = req.result;
    if (registros.length === 0) {
      alert("✅ No hay registros pendientes por enviar.");
      return;
    }

    alert(`🚀 Iniciando envío de ${registros.length} registro(s) pendiente(s)... Por favor, no cierres la app.`);
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) { loadingOverlay.classList.remove('d-none'); }
    let enviados = 0;

    for (let record of registros) {
      try {
        // OJO: Pega aquí la misma URL de Apps Script que usaste arriba
        const response = await fetch('https://script.google.com/macros/s/AKfycby7kqN1YCUbgjA_RJHpsMkQmo4IsTZeC2pXElzAkvwYGvaz2iUuNIQbT2_f7oCpkxCV/exec', {
          method: 'POST',
          body: JSON.stringify(record)
        });

        if (!response.ok) throw new Error('Error de red');
        
        // Si se envió bien, lo eliminamos de la memoria local
        const delTx = db.transaction(STORE_NAME, 'readwrite');
        delTx.objectStore(STORE_NAME).delete(record.id);
        enviados++;

      } catch (error) {
        console.error("Fallo al enviar registro:", error);
        break; // Rompemos el ciclo si falla uno para no colapsar la app
      }
    }

    updatePendingCount(); // Actualiza el botón para que vuelva a decir "Pendientes: 0"
    if (loadingOverlay) { loadingOverlay.classList.add('d-none'); }
    
    if (enviados > 0) alert(`✅ ¡Se enviaron ${enviados} registro(s) con éxito al servidor!`);
    else alert("⚠️ Hubo un problema de conexión. Intenta de nuevo más tarde.");
  };
}

// 7. Auto-guardado de borradores al navegar
document.addEventListener('DOMContentLoaded', () => {
    const forms = document.querySelectorAll('form');
    forms.forEach(form => {
        const formId = form.id;
        if (!formId) return;

        // Restaurar datos al cargar la página
        const draft = sessionStorage.getItem('borrador_' + formId);
        if (draft) {
            const data = JSON.parse(draft);
            for (let key in data) {
                const field = form.elements[key];
                if (field && field.type !== 'file') {
                    if (field.type === 'checkbox' || field.type === 'radio') {
                        if (field.length) { // Múltiples casillas con el mismo nombre
                            field.forEach(f => { if (data[key].includes(f.value)) f.checked = true; });
                        } else {
                            field.checked = data[key];
                        }
                    } else {
                        field.value = data[key];
                        // Disparar evento para que se abran los campos condicionales
                        if (field.tagName === 'SELECT') field.dispatchEvent(new Event('change'));
                    }
                }
            }
        }

        // Guardar datos en silencio cada vez que escriben algo
        form.addEventListener('input', e => {
            if (e.target.type === 'file') return; // Las fotos no se pueden auto-guardar por seguridad del navegador
            const formData = new FormData(form);
            const data = {};
            for (let [key, value] of formData.entries()) {
                if (data[key]) {
                    if (!Array.isArray(data[key])) data[key] = [data[key]];
                    data[key].push(value);
                } else {
                    data[key] = value;
                }
            }
            sessionStorage.setItem('borrador_' + formId, JSON.stringify(data));
        });
    });
});
