'use strict';

const BpmnModdle = require('bpmn-moddle');
const Code = require('code');
const factory = require('../helpers/factory');
const Lab = require('lab');
const mapper = require('../../lib/mapper');
const nock = require('nock');
const testHelpers = require('../helpers/testHelpers');

const lab = exports.lab = Lab.script();
const expect = Code.expect;

const Bpmn = require('../..');
const bpmnModdle = new BpmnModdle({
  camunda: require('camunda-bpmn-moddle/resources/camunda')
});
const ServiceTask = mapper('bpmn:ServiceTask');

const bupServiceFn = testHelpers.serviceFn;

lab.experiment('ServiceTask', () => {
  lab.after((done) => {
    testHelpers.serviceFn = bupServiceFn;
    done();
  });

  lab.describe('ctor', () => {
    lab.test('stores service if extension name', (done) => {
      const processXml = factory.resource('service-task.bpmn');

      const engine = new Bpmn.Engine({
        source: processXml
      });

      engine.getInstance((err, instance) => {
        if (err) return done(err);
        const task = instance.getChildActivityById('serviceTask');
        expect(task).to.include(['service']);
        done();
      });
    });

    lab.test('stores expression service', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
  <process id="theProcess" isExecutable="true">
    <serviceTask id="serviceTask" name="Get" camunda:expression="\${services.get}" />
  </process>
</definitions>`;

      const engine = new Bpmn.Engine({
        source: processXml,
        moddleOptions: {
          camunda: require('camunda-bpmn-moddle/resources/camunda')
        }
      });

      engine.getInstance((err, instance) => {
        if (err) return done(err);
        const task = instance.getChildActivityById('serviceTask');
        expect(task).to.include(['service']);
        done();
      });
    });

    lab.test('throws if service definition is not found', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <process id="theProcess" isExecutable="true">
    <serviceTask id="serviceTask" name="Get" />
  </process>
</definitions>`;

      bpmnModdle.fromXML(processXml, (err, def, moddleContext) => {
        if (err) return done(err);

        const Context = require('../../lib/Context');
        function test() {
          new Context('theProcess', moddleContext); // eslint-disable-line no-new
        }

        expect(test).to.throw(Error, /No service defined/i);
        done();
      });

    });
  });

  lab.describe('execute', () => {
    lab.test('executes service', (done) => {
      testHelpers.serviceFn = (message, callback) => {
        callback();
      };

      const processXml = factory.resource('service-task.bpmn');

      const engine = new Bpmn.Engine({
        source: processXml
      });

      engine.execute({
        services: {
          postMessage: {
            module: './test/helpers/testHelpers',
            fnName: 'serviceFn'
          }
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          done();
        });
      });
    });

    lab.test('can access variables', (done) => {
      testHelpers.serviceFn = (message, callback) => {
        message.variables.input = 'wuiiii';
        callback();
      };

      const processXml = factory.resource('service-task.bpmn');

      const engine = new Bpmn.Engine({
        source: processXml
      });

      engine.execute({
        services: {
          postMessage: {
            module: './test/helpers/testHelpers',
            fnName: 'serviceFn'
          }
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.variables.input).to.equal('wuiiii');
          expect(instance.getChildActivityById('serviceTask').taken).to.be.true();
          done();
        });
      });
    });

    lab.test('error in callback takes bound error event', (done) => {
      testHelpers.serviceFn = (message, callback) => {
        callback(new Error('Failed'));
      };

      const processXml = factory.resource('service-task.bpmn');

      const engine = new Bpmn.Engine({
        source: processXml
      });

      engine.execute({
        services: {
          postMessage: {
            module: './test/helpers/testHelpers',
            fnName: 'serviceFn'
          }
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.getChildActivityById('end').taken).to.be.false();
          expect(instance.getChildActivityById('errorEvent').taken).to.be.true();
          done();
        });
      });
    });

    lab.test('times out if bound timeout event if callback is not called within timeout duration', (done) => {
      testHelpers.serviceFn = () => {};

      const processXml = factory.resource('service-task.bpmn');

      const engine = new Bpmn.Engine({
        source: processXml
      });

      engine.execute({
        services: {
          postMessage: {
            module: './test/helpers/testHelpers',
            fnName: 'serviceFn'
          }
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.getChildActivityById('end').taken).to.be.false();
          expect(instance.getChildActivityById('timerEvent').taken).to.be.true();
          done();
        });
      });
    });

    lab.test('uses input parameters and saves defined output to variables', (done) => {
      nock('http://example.com')
        .defaultReplyHeaders({
          'Content-Type': 'application/json'
        })
        .get('/test')
        .reply(200, {
          data: 4
        });

      const processXml = factory.resource('service-task-io.bpmn');

      const engine = new Bpmn.Engine({
        source: processXml
      });

      engine.execute({
        services: {
          getRequest: {
            module: 'request',
            fnName: 'get'
          }
        },
        variables: {
          apiPath: 'http://example.com/test'
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.variables).to.include(['statusCode', 'body']);
          expect(instance.variables.statusCode).to.equal(200);
          expect(instance.variables.body).to.equal('{\"data\":4}');
          done();
        });
      });
    });

    lab.test('executes function call expression with context as argument', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
  <process id="theProcess" isExecutable="true">
    <serviceTask id="serviceTask" name="Get" camunda:expression="\${services.getService()}" camunda:resultVariable="output" />
  </process>
</definitions>`;

      const engine = new Bpmn.Engine({
        source: processXml,
        moddleOptions: {
          camunda: require('camunda-bpmn-moddle/resources/camunda')
        }
      });

      engine.execute({
        services: {
          getService: () => {
            return (executionContext, callback) => {
              callback(null, executionContext.variables.input, 'success');
            };
          }
        },
        variables: {
          input: 1
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.variables.taskInput.serviceTask).to.include(['output']);
          expect(instance.variables.taskInput.serviceTask.output[0]).to.equal(1);
          expect(instance.variables.taskInput.serviceTask.output[1]).to.equal('success');
          done();
        });
      });
    });

    lab.test('executes expression function call with variable reference argument with context as argument', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
  <process id="theProcess" isExecutable="true">
    <serviceTask id="serviceTask" name="Get" camunda:expression="\${services.getService(variables.input)}" camunda:resultVariable="output" />
  </process>
</definitions>`;

      const engine = new Bpmn.Engine({
        source: processXml,
        moddleOptions: {
          camunda: require('camunda-bpmn-moddle/resources/camunda')
        }
      });

      engine.execute({
        services: {
          getService: (input) => {
            return (executionContext, callback) => {
              callback(null, input);
            };
          }
        },
        variables: {
          input: 1
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.variables.taskInput.serviceTask).to.include(['output']);
          expect(instance.variables.taskInput.serviceTask.output[0]).to.equal(1);
          done();
        });
      });
    });

    lab.test('executes expression function call with static value argument with context as argument', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
  <process id="theProcess" isExecutable="true">
    <serviceTask id="serviceTask" name="Get" camunda:expression="\${services.getService(whatever value)}" camunda:resultVariable="output" />
  </process>
</definitions>`;

      const engine = new Bpmn.Engine({
        source: processXml,
        moddleOptions: {
          camunda: require('camunda-bpmn-moddle/resources/camunda')
        }
      });

      engine.execute({
        services: {
          getService: (input) => {
            return (executionContext, callback) => {
              callback(null, input);
            };
          }
        },
        variables: {
          input: 1
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.variables.taskInput.serviceTask).to.include(['output']);
          expect(instance.variables.taskInput.serviceTask.output[0]).to.equal('whatever value');
          done();
        });
      });
    });

    lab.test('executes function reference expression with context as argument', (done) => {
      const processXml = `
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
  <process id="theProcess" isExecutable="true">
    <serviceTask id="serviceTask" name="Get" camunda:expression="\${services.getService}" camunda:resultVariable="output" />
  </process>
</definitions>`;

      const engine = new Bpmn.Engine({
        source: processXml,
        moddleOptions: {
          camunda: require('camunda-bpmn-moddle/resources/camunda')
        }
      });

      engine.execute({
        services: {
          getService: (executionContext, callback) => {
            callback(null, executionContext.variables.input);
          }
        },
        variables: {
          input: 1
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.variables.taskInput.serviceTask).to.include(['output']);
          done();
        });
      });
    });
  });

  lab.describe('io', () => {
    let context;
    lab.beforeEach((done) => {
      const processXml = factory.resource('service-task-io-types.bpmn').toString();
      testHelpers.getContext(processXml, (err, result) => {
        if (err) return done(err);
        context = result;
        done();
      });
    });

    lab.test('returns mapped output', (done) => {
      context.variables = {
        apiPath: 'http://example-2.com',
        input: 2,
      };
      context.services = {
        get: (arg, next) => {
          next(null, {
            statusCode: 200,
            pathname: '/ignore'
          }, {
            data: arg.input
          });
        }
      };

      const task = context.getChildActivityById('serviceTask');
      task.once('end', (activity, output) => {
        expect(output).to.equal({
          statusCode: 200,
          body: {
            data: 2
          }
        });
        done();
      });

      task.enter();
      task.execute();
    });

  });

  lab.describe('Camunda connector is defined with input/output', () => {
    let moddleContext, context;
    lab.before((done) => {
      bpmnModdle.fromXML(factory.resource('issue-4.bpmn').toString(), (err, def, result) => {
        if (err) return done(err);

        moddleContext = result;
        const Context = require('../../lib/Context');
        context = new Context('Send_Mail_Process', moddleContext, {
          services: {
            'send-email': (emailAddress, callback) => {
              callback(null, 'success');
            }
          },
          variables: {
            emailAddress: 'lisa@example.com'
          }
        });
        done();
      });
    });

    lab.test('service task has io', (done) => {
      const task = new ServiceTask(moddleContext.elementsById.sendEmail_1, context);
      expect(task.io, 'task IO').to.exist();
      expect(task.io.input).to.exist();
      expect(task.io.output).to.exist();
      done();
    });

    lab.test('io returns input values from message', (done) => {
      const task = new ServiceTask(moddleContext.elementsById.sendEmail_1, context);
      expect(task.io.getInput({
        emailAddress: 'testio@example.com'
      })).to.equal({emailAddress: 'testio@example.com'});
      done();
    });

    lab.test('io returns input values from context variables', (done) => {
      const task = new ServiceTask(moddleContext.elementsById.sendEmail_1, context);
      expect(task.io.getInput()).to.equal({emailAddress: 'lisa@example.com'});
      done();
    });

    lab.test('executes connector-id service', (done) => {
      const engine = new Bpmn.Engine({
        source: factory.resource('issue-4.bpmn'),
        moddleOptions: {
          camunda: require('camunda-bpmn-moddle/resources/camunda')
        }
      });

      engine.execute({
        services: {
          'send-email': (emailAddress, callback) => {
            callback(null, 'success');
          }
        },
        variables: {
          emailAddress: 'lisa@example.com'
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          done();
        });
      });
    });

    lab.test('executes service using defined input', (done) => {
      const engine = new Bpmn.Engine({
        source: factory.resource('issue-4.bpmn'),
        moddleOptions: {
          camunda: require('camunda-bpmn-moddle/resources/camunda')
        }
      });

      let inputArg;
      engine.execute({
        services: {
          'send-email': (emailAddress, callback) => {
            inputArg = emailAddress;
            callback(null, 'success');
          }
        },
        variables: {
          emailAddress: 'lisa@example.com'
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(inputArg).to.equal('lisa@example.com');
          done();
        });
      });
    });

    lab.test('returns defined output', (done) => {
      const engine = new Bpmn.Engine({
        source: factory.resource('issue-4.bpmn'),
        moddleOptions: {
          camunda: require('camunda-bpmn-moddle/resources/camunda')
        }
      });

      engine.execute({
        services: {
          'send-email': (emailAddress, callback) => {
            callback(null, 10);
          }
        },
        variables: {
          emailAddress: 'lisa@example.com'
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.variables).to.include({messageId: 10});
          done();
        });
      });
    });
  });

  lab.describe('issue #5', () => {

    lab.test('issue #5', (done) => {
      const processXml = `
  <?xml version="1.0" encoding="UTF-8"?>
  <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">
    <process id="theProcess" isExecutable="true">
      <serviceTask id="Task_15g4wm5" name="Dummy Task">
        <extensionElements>
          <camunda:properties>
            <camunda:property name="service" value="dummy" />
          </camunda:properties>
          <camunda:inputOutput>
            <camunda:inputParameter name="templateId">template_1234</camunda:inputParameter>
            <camunda:inputParameter name="templateArgs">
              <camunda:map>
                <camunda:entry key="url"><![CDATA[\${services.getUrl('task1')}]]></camunda:entry>
              </camunda:map>
            </camunda:inputParameter>
          </camunda:inputOutput>
        </extensionElements>
      </serviceTask>
    </process>
  </definitions>
      `;
      const engine = new Bpmn.Engine({
        source: processXml,
        moddleOptions: {
          camunda: require('camunda-bpmn-moddle/resources/camunda')
        }
      });

      engine.execute({
        services: {
          dummy: (executionContext, serviceCallback) => {
            serviceCallback(null, ['dummy']);
          },
          getUrl: (path) => {
            return `http://example.com/${path}`;
          }
        },
        variables: {
          emailAddress: 'lisa@example.com'
        }
      }, (err, instance) => {
        if (err) return done(err);
        instance.once('end', () => {
          expect(instance.variables.taskInput.Task_15g4wm5).to.include([ [ 'dummy' ] ]);
          done();
        });
      });
    });
  });
});
