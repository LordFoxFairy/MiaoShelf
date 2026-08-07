import {
  ConnectorError,
  type ConnectorCredentials,
  type ConnectorFactory,
  type ConnectorRuntimeOptions,
  type ProviderId,
  type SourceConnector,
} from "@/lib/connectors/types";

/**
 * 连接器注册表。
 *
 * 这是"新增一个货源平台"唯一需要改的地方：写好 Adapter，在启动时 register 一次。
 * 同步引擎只调用 createConnector(provider, credentials)，永远不知道背后是谁。
 */
const registry = new Map<ProviderId, ConnectorFactory>();

export function registerConnector(
  provider: ProviderId,
  factory: ConnectorFactory,
): void {
  registry.set(provider, factory);
}

export function createConnector(
  provider: ProviderId,
  credentials: ConnectorCredentials,
  options?: ConnectorRuntimeOptions,
): SourceConnector {
  const factory = registry.get(provider);
  if (!factory) {
    throw new ConnectorError(
      "UNKNOWN",
      `未注册的货源平台：${provider}。请检查连接器注册是否被引入。`,
    );
  }
  return factory(credentials, options);
}

export function hasConnector(provider: ProviderId): boolean {
  return registry.has(provider);
}

export function registeredProviders(): ProviderId[] {
  return Array.from(registry.keys());
}

/** 仅供测试。 */
export function clearRegistry(): void {
  registry.clear();
}
