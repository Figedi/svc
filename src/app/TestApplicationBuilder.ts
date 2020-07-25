import { Container } from "inversify";
import { ApplicationBuilder, RegisterFnArgs } from "./ApplicationBuilder";
import { Logger } from "../logger";
import { UnpackTransformConfigTypes } from "./types";

export type Stub<T> = {
    [k in keyof T]: any;
};

export class TestApplicationBuilder<Config, RemoteConfig> {
    private stubs: Record<string, Stub<any>> = {};

    public static mount<C, R>(appBuilder: ApplicationBuilder<C, R>): TestApplicationBuilder<C, R> {
        return new TestApplicationBuilder(appBuilder);
    }

    private constructor(private appBuilder: ApplicationBuilder<Config, RemoteConfig>) {}

    private getAppBuilderProp = <T>(propName: string): T => {
        if (!(propName in this.appBuilder)) {
            throw new Error(`'${propName}' not in mounted app-builder`);
        }
        return (<any>this.appBuilder)[propName];
    };

    public rebindAsStub<T>(
        name: string,
        registerFn: (args: RegisterFnArgs<Config, RemoteConfig>) => Stub<T>,
    ): TestApplicationBuilder<Config, RemoteConfig> {
        this.getAppBuilderProp<Container>("container")
            .rebind(name)
            .toDynamicValue(context => {
                try {
                    const stub = registerFn(this.getAppBuilderProp<any>("buildResolveArgs")(context.container));
                    this.stubs[name] = stub;
                    return stub;
                } catch (e) {
                    this.getAppBuilderProp<Logger>("rootLogger").info(
                        `Error while instantiating service '${name}': ${e.message}`,
                    );
                    throw e;
                }
            })
            .inSingletonScope();

        return this;
    }

    public overwriteConfig<C>(
        overwriteConfigFn: (config: UnpackTransformConfigTypes<Config>) => C,
    ): TestApplicationBuilder<C, RemoteConfig> {
        const newConfig = overwriteConfigFn(this.getAppBuilderProp<UnpackTransformConfigTypes<Config>>("config"));

        this.appBuilder = this.appBuilder.setEnv(() => <any>newConfig);
        return (this as any) as TestApplicationBuilder<C, RemoteConfig>;
    }

    public getStub<StubType>(stubName: string): StubType {
        if (!this.stubs[stubName]) {
            throw new Error(`No stub with name ${stubName} registered`);
        }
        return this.stubs[stubName] as StubType;
    }

    public getAllStubs(): Record<string, Stub<any>> {
        return this.stubs;
    }

    public async runInContainer(
        runnable: (args: RegisterFnArgs<Config, RemoteConfig>) => void | Promise<void>,
    ): Promise<void> {
        await Promise.all(
            this.getAppBuilderProp<any[]>("servicesWithLifecycleHandlers").map(svc => svc.preflight && svc.preflight()),
        );
        try {
            await runnable(
                this.getAppBuilderProp<any>("buildResolveArgs")(this.getAppBuilderProp<Container>("container")),
            );
        } finally {
            await Promise.all(
                this.getAppBuilderProp<any[]>("servicesWithLifecycleHandlers").map(
                    svc => svc.shutdown && svc.shutdown(),
                ),
            );
        }
    }
}
