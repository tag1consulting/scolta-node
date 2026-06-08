/**
 * Hosting environment detection (port of `Environment\*`).
 *
 * Detects managed/serverless hosting via environment variables. The PHP version
 * also checks PHP-only constants which have no JS equivalent and are omitted.
 * Adds the serverless env vars relevant to Node deployments (VERCEL, NETLIFY,
 * AWS_LAMBDA_FUNCTION_NAME).
 */

const MIB = 1024 * 1024;

export enum HostingEnvironment {
  WP_ENGINE = "wp_engine",
  KINSTA = "kinsta",
  FLYWHEEL = "flywheel",
  PRESSABLE = "pressable",
  PANTHEON = "pantheon",
  ACQUIA = "acquia",
  PLATFORM_SH = "platform_sh",
  VAPOR = "vapor",
  VERCEL = "vercel",
  NETLIFY = "netlify",
  AWS_LAMBDA = "aws_lambda",
  RESTRICTED_EXEC = "restricted_exec",
  STANDARD = "standard",
}

export interface HostingConstraints {
  maxExecutionTime: number;
  memoryLimit: number;
  execAvailable: boolean;
  ephemeralFilesystem: boolean;
  note: string;
}

function emptyConstraints(overrides: Partial<HostingConstraints> = {}): HostingConstraints {
  return {
    maxExecutionTime: 0,
    memoryLimit: 0,
    execAvailable: true,
    ephemeralFilesystem: false,
    note: "",
    ...overrides,
  };
}

export class HostingDetector {
  static detect(env: NodeJS.ProcessEnv = process.env): HostingEnvironment {
    if (env["WPE_APIKEY"]) return HostingEnvironment.WP_ENGINE;
    if (env["KINSTA_CACHE_ZONE"]) return HostingEnvironment.KINSTA;
    if (env["PANTHEON_ENVIRONMENT"]) return HostingEnvironment.PANTHEON;
    if (env["AH_SITE_ENVIRONMENT"]) return HostingEnvironment.ACQUIA;
    if (env["PLATFORM_ENVIRONMENT"]) return HostingEnvironment.PLATFORM_SH;
    if (env["VERCEL"]) return HostingEnvironment.VERCEL;
    if (env["NETLIFY"]) return HostingEnvironment.NETLIFY;
    if (env["VAPOR_SSM_PATH"]) return HostingEnvironment.VAPOR;
    if (env["AWS_LAMBDA_FUNCTION_NAME"]) return HostingEnvironment.AWS_LAMBDA;
    return HostingEnvironment.STANDARD;
  }

  static constraints(env: NodeJS.ProcessEnv = process.env): HostingConstraints {
    const detected = HostingDetector.detect(env);
    switch (detected) {
      case HostingEnvironment.PANTHEON:
        return emptyConstraints({
          maxExecutionTime: 120,
          note: "Pantheon has a 120-second hard limit. Use the TS indexer for large sites.",
        });
      case HostingEnvironment.ACQUIA:
        return emptyConstraints({
          maxExecutionTime: 300,
          memoryLimit: 128 * MIB,
          note: "Acquia default memory is 128MB. Use the TS indexer for large sites.",
        });
      case HostingEnvironment.WP_ENGINE:
      case HostingEnvironment.KINSTA:
      case HostingEnvironment.FLYWHEEL:
      case HostingEnvironment.PRESSABLE:
      case HostingEnvironment.RESTRICTED_EXEC:
        return emptyConstraints({
          execAvailable: false,
          note: "Native binaries disabled. TS indexer used automatically.",
        });
      case HostingEnvironment.VAPOR:
      case HostingEnvironment.AWS_LAMBDA:
      case HostingEnvironment.VERCEL:
      case HostingEnvironment.NETLIFY:
        return emptyConstraints({
          maxExecutionTime: 900,
          ephemeralFilesystem: true,
          note: "Serverless filesystem is ephemeral. Trigger rebuilds via webhook/CI and store the index in a CDN/static dir.",
        });
      default:
        return emptyConstraints();
    }
  }

  static describe(env: NodeJS.ProcessEnv = process.env): string {
    const detected = HostingDetector.detect(env);
    const constraints = HostingDetector.constraints(env);
    let desc =
      detected === HostingEnvironment.STANDARD
        ? "Standard hosting"
        : detected
            .replace(/_/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
    if (constraints.note !== "") {
      desc += " — " + constraints.note;
    }
    return desc;
  }
}
