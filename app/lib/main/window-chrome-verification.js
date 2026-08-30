'use strict';

function summarizeWindowChromeVerification({
  automatedPassed,
  physicalDoubleClickObserved,
  rightClickSystemMenuObserved,
  nativeDragMoved,
  edgeSnapObserved,
  winZSnapLayoutsObserved,
  borderResizeObserved,
}) {
  const physicalEvidence = {
    doubleClick: physicalDoubleClickObserved === true,
    rightClickSystemMenu: rightClickSystemMenuObserved === true,
    titleDrag: nativeDragMoved === true,
    edgeSnap: edgeSnapObserved === true,
    winZSnapLayouts: winZSnapLayoutsObserved === true,
    borderResize: borderResizeObserved === true,
  };
  const missingPhysicalEvidence = Object.entries(physicalEvidence)
    .filter(([, observed]) => !observed)
    .map(([name]) => name);
  const nativeInteractionVerified = missingPhysicalEvidence.length === 0;
  return {
    automatedPassed: automatedPassed === true,
    physicalEvidence,
    missingPhysicalEvidence,
    nativeInteractionVerification: nativeInteractionVerified ? 'passed' : 'inconclusive',
    conclusive: automatedPassed === true && nativeInteractionVerified,
    manualGateRequired: !nativeInteractionVerified,
    passed: automatedPassed === true && nativeInteractionVerified,
  };
}

module.exports = { summarizeWindowChromeVerification };
