const STALL_TIMEOUT_MS = 30000;

export function uploadWithProgress(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);

    // A stalled connection fires no progress, no error, and no load event —
    // without this, one bad connection hangs its upload slot forever.
    let stalled = false;
    let stallTimer: ReturnType<typeof setTimeout>;
    function resetStallTimer() {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, STALL_TIMEOUT_MS);
    }

    xhr.upload.onprogress = (e) => {
      resetStallTimer();
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };
    xhr.onload = () => {
      clearTimeout(stallTimer);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => {
      clearTimeout(stallTimer);
      reject(new Error("Upload failed"));
    };
    xhr.onabort = () => {
      clearTimeout(stallTimer);
      if (stalled) {
        reject(new Error("Upload stalled — check your connection and try again."));
      } else {
        reject(new DOMException("Upload cancelled", "AbortError"));
      }
    };
    signal?.addEventListener("abort", () => xhr.abort());
    resetStallTimer();
    xhr.send(file);
  });
}
