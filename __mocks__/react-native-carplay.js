// In-memory CarPlay stand-in, mirrors __mocks__/react-native-track-player.js's style.
// Tests drive lifecycle with __connect/__disconnect and simulate taps with __selectItem.
const connectCallbacks = new Set();
const disconnectCallbacks = new Set();
const templateStack = [];

const CarPlay = {
  connected: false,
  window: undefined,
  registerOnConnect: jest.fn((cb) => connectCallbacks.add(cb)),
  unregisterOnConnect: jest.fn((cb) => connectCallbacks.delete(cb)),
  registerOnDisconnect: jest.fn((cb) => disconnectCallbacks.add(cb)),
  unregisterOnDisconnect: jest.fn((cb) => disconnectCallbacks.delete(cb)),
  setRootTemplate: jest.fn(async (template) => {
    templateStack.length = 0;
    templateStack.push(template);
  }),
  pushTemplate: jest.fn(async (template) => {
    templateStack.push(template);
  }),
  popTemplate: jest.fn(async () => {
    templateStack.pop();
  }),
  popToRootTemplate: jest.fn(async () => {
    templateStack.length = Math.min(templateStack.length, 1);
  }),
  enableNowPlaying: jest.fn(async () => {}),
};

class ListTemplate {
  constructor(config) {
    this.config = config;
    this.id = config.id ?? `list-${templateStack.length}-${Math.random()}`;
  }
  updateSections(sections) {
    this.config.sections = sections;
  }
}

class NowPlayingTemplate {
  constructor(config) {
    this.config = config;
    this.id = "now-playing";
  }
}

module.exports = {
  __esModule: true,
  CarPlay,
  ListTemplate,
  NowPlayingTemplate,
  __connect: (window = { width: 800, height: 480, scale: 2 }) =>
    connectCallbacks.forEach((cb) => cb(window)),
  __disconnect: () => disconnectCallbacks.forEach((cb) => cb()),
  __selectItem: async (template, index) => {
    if (template.config.onItemSelect) {
      await template.config.onItemSelect({ templateId: template.id, index });
    }
  },
  __reset: () => {
    connectCallbacks.clear();
    disconnectCallbacks.clear();
    templateStack.length = 0;
    CarPlay.setRootTemplate.mockClear();
    CarPlay.pushTemplate.mockClear();
    CarPlay.popTemplate.mockClear();
    CarPlay.popToRootTemplate.mockClear();
  },
  __currentRoot: () => templateStack[0],
  __stack: () => [...templateStack],
};
