export function createStockInPrintSubmitController() {
  let isProcessing = false;

  return {
    async run({ printFn, submitFn }) {
      if (isProcessing) {
        return {
          ok: false,
          duplicate: true,
          message: 'Stock-In processing is already in progress.',
        };
      }

      isProcessing = true;

      try {
        await printFn();
        await submitFn();
        return {
          ok: true,
          duplicate: false,
          message: 'Stock-In submitted successfully.',
        };
      } catch (error) {
        return {
          ok: false,
          duplicate: false,
          message: error?.message || 'Printing or submission failed.',
        };
      } finally {
        isProcessing = false;
      }
    },
  };
}
