import { Container } from "@cloudflare/containers";
export class MediaContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "2m";
  enableInternet = false;
}
export class ProtocolContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "2m";
}
