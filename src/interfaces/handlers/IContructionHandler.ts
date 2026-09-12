export default interface IConstructionHandler {
    LoadEvents(): Promise<void>;
    LoadCommands(): Promise<void>;
}