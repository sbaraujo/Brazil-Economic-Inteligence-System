const config = {
  packagerConfig: {
    asar: true,
    name: 'SYGMA BRAZIL ECONOMIC INTELLIGENCE AI',
    executableName: 'sygma-brazil-economic-intelligence-ai',
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'sygma_brazil_economic_intelligence_ai',
        setupExe: 'SYGMA-BRAZIL-ECONOMIC-INTELLIGENCE-AI-Setup-1.0.0.exe',
      },
    },
  ],
};

export default config;
