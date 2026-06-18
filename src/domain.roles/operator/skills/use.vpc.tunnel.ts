#!/bin/bash

import type { DeclastructProvider } from 'declastruct';
import {
  type DeclaredAwsEc2Instance,
  type DeclaredAwsRdsCluster,
  DeclaredAwsVpcTunnel,
  getDeclastructAwsProvider,
} from 'declastruct-aws';
import {
  DeclaredUnixHostAlias,
  getDeclastructUnixNetworkProvider,
} from 'declastruct-unix-network';
//bin/true && exec npx declastruct apply --plan yolo --wish "$0"
//
/**
 * 🦺 use.vpc.tunnel — establish secure database tunnel
 *
 * .what = creates ssm tunnel to rds endpoint via ec2 bastion
 *
 * .why  = enables local database access without public rds exposure
 *
 * usage:
 *   rhx use.vpc.tunnel --bastion vpc-main-bastion --cluster mydb --port 5433 --host mydb.local
 *   rhx use.vpc.tunnel --config ./tunnel.config.json
 *
 * args:
 *   --bastion   ssm target instance id (e.g., vpc-main-bastion)
 *   --cluster   rds cluster name
 *   --port      local port to bind (default: 5432)
 *   --host      local hostname alias (default: none)
 *   --config    path to json config file (alternative to args)
 *
 * config file format:
 *   {
 *     "bastion": { "exid": "vpc-main-bastion" },
 *     "cluster": { "name": "mydb" },
 *     "local": { "port": 5432, "host": "mydb.local" }
 *   }
 *
 * guarantee:
 *   - exit 0 = tunnel active
 *   - exit 1 = malfunction (aws error, ssm failure)
 *   - exit 2 = constraint (absent args, bad config)
 */
import { RefByUnique } from 'domain-objects';

/**
 * .what = tunnel configuration shape
 */
interface TunnelConfig {
  account: string;
  region: string;
  bastion: { exid: string };
  cluster: { name: string };
  local: { port: number; host?: string };
}

/**
 * .what = parse tunnel config from env or file
 * .why  = supports both cli args via env vars and json config file
 */
const getTunnelConfig = async (): Promise<TunnelConfig> => {
  // check for config file path
  const configPath = process.env.DECLASTRUCT_CONFIG;
  if (configPath) {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content) as TunnelConfig;
  }

  // fall back to env vars (set by shell wrapper)
  const account = process.env.AWS_ACCOUNT_ID;
  const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  const bastion = process.env.VPC_TUNNEL_BASTION;
  const cluster = process.env.VPC_TUNNEL_CLUSTER;
  const port = process.env.VPC_TUNNEL_PORT;
  const host = process.env.VPC_TUNNEL_HOST;

  if (!account || !region) {
    throw new Error(
      'absent required config: AWS_ACCOUNT_ID and AWS_REGION (or AWS_DEFAULT_REGION)',
    );
  }

  if (!bastion || !cluster) {
    throw new Error(
      'absent required config: --bastion and --cluster (or --config path)',
    );
  }

  return {
    account,
    region,
    bastion: { exid: bastion },
    cluster: { name: cluster },
    local: {
      port: port ? parseInt(port, 10) : 5432,
      host: host || undefined,
    },
  };
};

export const getProviders = async (): Promise<DeclastructProvider[]> => [
  await getDeclastructAwsProvider({}, { log: console }),
  await getDeclastructUnixNetworkProvider({}, { log: console }),
];

export const getResources = async (): Promise<
  Array<
    | InstanceType<typeof DeclaredAwsVpcTunnel>
    | InstanceType<typeof DeclaredUnixHostAlias>
  >
> => {
  const config = await getTunnelConfig();

  // create refs to the aws resources
  const cluster = RefByUnique.as<typeof DeclaredAwsRdsCluster>({
    name: config.cluster.name,
  });
  const bastion = RefByUnique.as<typeof DeclaredAwsEc2Instance>({
    exid: config.bastion.exid,
  });

  // open the tunnel
  const tunnel = DeclaredAwsVpcTunnel.as({
    account: config.account,
    region: config.region,
    via: { mechanism: 'aws.ssm', bastion },
    into: { cluster },
    from: {
      host: 'localhost',
      port: config.local.port,
    },
    status: 'OPEN',
  });

  const resources: Array<
    | InstanceType<typeof DeclaredAwsVpcTunnel>
    | InstanceType<typeof DeclaredUnixHostAlias>
  > = [tunnel];

  // bind the host alias if requested
  if (config.local.host) {
    const hostAlias = DeclaredUnixHostAlias.as({
      via: '/etc/hosts',
      from: config.local.host,
      into: '127.0.0.1',
    });
    resources.push(hostAlias);
  }

  return resources;
};
