importScripts('/js/site-facts.js', '/js/bulk-core.js', '/js/vendor/read-excel-file.min.js');

self.onmessage = async ({ data: buffer }) => {
  try {
    SignatureBulk.checkXlsxArchive(buffer);
    const sheets = await readXlsxFile(buffer, { sheets: [1], parseNumber: (value) => value });
    const parsed = SignatureBulk.employeesFromGrid(sheets[0].data);
    self.postMessage({ ok: true, parsed });
  } catch (err) {
    self.postMessage({ ok: false, message: err.code ? err.message : 'Could not read this workbook. Save it as .xlsx or CSV and try again.' });
  }
};
