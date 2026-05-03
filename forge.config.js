module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'UniGet',
    ignore: [
      /^\/out($|\/)/,
      /^\/dist($|\/)/,
      /^\/\.git($|\/)/
    ]
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'UniGet',
        setupIcon: 'public/icon.ico'
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};
