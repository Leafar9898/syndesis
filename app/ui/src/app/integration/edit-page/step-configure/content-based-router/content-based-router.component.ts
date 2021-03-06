/*
 * Copyright (C) 2016 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  Component,
  ViewEncapsulation,
  OnDestroy, Input, Output, EventEmitter, OnChanges, OnInit
} from '@angular/core';

import {
  ContentBasedRouter,
  CurrentFlowService,
  FlowPageService,
  FlowOption,
  INTEGRATION_ADD_FLOW,
  INTEGRATION_REMOVE_FLOW,
  createStepWithConnection
} from '@syndesis/ui/integration/edit-page';
import {
  Action,
  Connection,
  IntegrationSupportService,
  Step,
  Flow,
  key,
  ALTERNATE
} from '@syndesis/ui/platform';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { FormArray, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ConnectionService } from '@syndesis/ui/store';
import { ModalService } from '@syndesis/ui/common';

@Component({
  selector: 'syndesis-content-based-router',
  templateUrl: './content-based-router.component.html',
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['./content-based-router.component.scss']
})
export class ContentBasedRouterComponent implements OnChanges, OnDestroy, OnInit {
  form: FormGroup;
  flowOptions: any = [];

  editMode = false;

  step: Step;

  loading = true;
  formValueChangeSubscription: Subscription;

  @Input()
  configuredProperties: ContentBasedRouter = {
    routingScheme: 'direct',
    default: 'comics',
    flows: [
      {
        condition: '${body.text} contains Superman',
        flow: 'superman'
      },
      {
        condition: '${body.text} contains Batman',
        flow: 'batman'
      }
    ]
  };
  @Input() valid: boolean;
  @Input() position: number;
  @Output() validChange = new EventEmitter<boolean>();
  @Output() configuredPropertiesChange = new EventEmitter<ContentBasedRouter>();

  constructor(
    private currentFlowService: CurrentFlowService,
    public integrationSupportService: IntegrationSupportService,
    public flowPageService: FlowPageService,
    public route: ActivatedRoute,
    private router: Router,
    private connectionService: ConnectionService,
    private fb: FormBuilder,
    private modalService: ModalService
  ) {
    // nothing to do
  }

  // this can be valid even if we can't fetch the form data
  initForm(
    configuredProperties?: ContentBasedRouter,
  ): void {
    let configuredFlows: FlowOption[] = undefined;
    const configuredFlowGroups = [];
    const configuredDefaultFlow = (configuredProperties && configuredProperties.default)
      ? configuredProperties.default
      : '';

    // build up the form array from the incoming values (if any)
    if (configuredProperties && configuredProperties.flows) {
      // TODO hackity hack
      if (typeof configuredProperties.flows === 'string') {
        configuredFlows = JSON.parse(<any>configuredProperties.flows);
      } else {
        configuredFlows = configuredProperties.flows;
      }

      for (const incomingFlow of configuredFlows) {
        configuredFlowGroups.push(this.fb.group(incomingFlow));
      }
    }
    const preloadedDefaultFlow = this.fb.group({
      defaultFlowEnabled: [configuredDefaultFlow !== '', null],
      defaultFlow: [configuredDefaultFlow, null]
    });

    let preloadedFlowOptions;
    if (configuredFlowGroups.length > 0) {
      preloadedFlowOptions = this.fb.array(configuredFlowGroups);
    } else {
      preloadedFlowOptions = this.fb.array([]);
    }

    this.flowOptions = preloadedFlowOptions;

    const formGroupObj = {
      defaultFlow: preloadedDefaultFlow,
      flowOptions: preloadedFlowOptions
    };

    this.form = this.fb.group(formGroupObj);

    if (preloadedFlowOptions.length == 0) {
      this.createFlow();
      this.editMode = true;
    }

    this.formValueChangeSubscription = this.form.valueChanges.subscribe(_ => {
      this.valid = this.form.valid;
      this.validChange.emit(this.valid);
    });

    this.loading = false;
  }

  ngOnChanges(changes: any) {
    if (!('position' in changes)) {
      return;
    }

    this.loading = true;

    if (!this.step) {
      this.step = this.currentFlowService.getStep(this.position);
    }

    // Fetch our form data
    this.initForm(this.configuredProperties);
  }

  ngOnInit(): void {
    // setTimeout needed so that the prompt template is available
    // and ExpressionChangedAfterItHasBeenCheckedError is not thrown
    setTimeout(() => {
      if (!this.currentFlowService.isSaved()) {
        this.modalService
          .show('save-cbr-integration-prompt').then(modal => {
          if (modal.result) {
            this.flowPageService.save(this.route);
          } else {
            this.flowPageService.cancel();
          }
        });
      }
    });
    this.step = this.currentFlowService.getStep(this.position);
  }

  ngOnDestroy(): void {
    if (this.formValueChangeSubscription) {
      this.formValueChangeSubscription.unsubscribe();
    }
  }

  addFlow(flowId: string): void {
    const newFlowGroup = <FormGroup>this.createFlowGroup(flowId);
    this.flowOptions = this.form.get('flowOptions') as FormArray;
    this.flowOptions.push(newFlowGroup);
  }

  createFlowGroup(flowId: string): FormGroup {
    const group = {
      flow: flowId,
      condition: ['', Validators.compose([
        Validators.required,
        Validators.maxLength(100)
      ])
      ]
    };
    return this.fb.group(group);
  }

  get myFlows(): FormArray {
    return <FormArray>this.flowOptions;
  }

  toggleEditMode() {
    this.editMode = !this.editMode;
  }

  toggleDefaultFlow() {
    if (this.form.controls.defaultFlow.get('defaultFlowEnabled').value) {
      this.createDefaultFlow();
    } else {
      this.removeDefaultFlow();
    }
  }

  createDefaultFlow() {
    this.doCreateFlow('Default Flow', 'default', 'Use this as default',
        flowId => this.form.controls.defaultFlow.get('defaultFlow').setValue(flowId));
  }

  removeDefaultFlow(): void {
    this.currentFlowService.events.emit({
      kind: INTEGRATION_REMOVE_FLOW,
      flowId: this.form.controls.defaultFlow.get('defaultFlow').value,
      onSave: () => {
        this.form.controls.defaultFlow.get('defaultFlow').setValue('');
        this.onChange();
      }
    });
  }

  removeFlow(index: number): void {
    this.currentFlowService.events.emit({
      kind: INTEGRATION_REMOVE_FLOW,
      flowId: this.myFlows.controls[index].get('flow').value,
      onSave: () => {
        this.myFlows.removeAt(index);
        this.onChange();
      }
    });
  }

  openDefaultFlow() {
    const flowId = this.configuredProperties.default;
    const integrationId = this.currentFlowService.integration.id;
    this.router.navigate([
      '/integrations',
      integrationId,
      flowId,
      'edit'
    ]);
  }

  openFlow(index: number) {
    const flowId = this.myFlows.controls[index].get('flow').value;
    const integrationId = this.currentFlowService.integration.id;
    this.router.navigate([
      '/integrations',
      integrationId,
      flowId,
      'edit'
    ]);
  }

  createFlow() {
    this.doCreateFlow('Conditional Flow', 'conditional', '* To be defined *', flowId => this.addFlow(flowId));
  }

  doCreateFlow(name: string, kind: string, description: string, then: (flowId: string) => void) {
    const currentFlow = this.currentFlowService.currentFlow;
    const primaryFlowId = currentFlow.id;
    const flowId = key();
    this.connectionService.get('flow')
      .subscribe(entity => {
        this.currentFlowService.events.emit({
          kind: INTEGRATION_ADD_FLOW,
          flow: {
            name: name,
            id: flowId,
            type: ALTERNATE,
            description: description,
            connections: [],
            steps: [
              this.createFlowStart(flowId, entity),
              this.createFlowEnd(entity)
            ],
            metadata: {
              excerpt: '',
              primaryFlowId: primaryFlowId,
              stepId: this.step.id,
              kind: kind
            }
          } as Flow,
          onSave: () => {
            then(flowId);
            this.onChange();
          }
        });
    });
  }

  createFlowStart(flowId: string, connection: Connection): Step {
    const step = {
      ...createStepWithConnection(connection),
      name: 'Flow start',
      action: this.getConnectorAction('io.syndesis:flow-start', connection),
      configuredProperties: {
        name: flowId,
      },
      metadata: {
        configured: true
      }
    };

    this.adaptOutputShape(step);
    return step;
  }

  createFlowEnd(connection: Connection): Step {
    return {
      ...createStepWithConnection(connection),
      name: 'Flow end',
      action: this.getConnectorAction('io.syndesis:flow-end', connection),
      metadata: {
        configured: true
      }
    };
  }

  getConnectorAction(id: string, connection: Connection): Action {
    return connection.connector.actions.find(action => action.id === id);
  }

  adaptOutputShape(step: Step) {
    if (this.step &&
      this.step.action &&
      this.step.action.descriptor &&
      this.step.action.descriptor.inputDataShape) {
      step.action.descriptor.outputDataShape = this.step.action.descriptor.inputDataShape;
    }
  }

  onChange() {
    this.valid = this.form.valid;
    this.validChange.emit(this.valid);
    if (!this.valid) {
      return;
    }

    const formGroupObj = this.form.value;

    const formattedProperties: ContentBasedRouter = {
      routingScheme: 'direct',
      default: this.form.controls.defaultFlow.get('defaultFlow').value,
      flows: formGroupObj.flowOptions
    };

    formattedProperties.flows.forEach(option => {
      const alternateFlow = this.currentFlowService.flows.find(flow => flow.id === option.flow);
      if (alternateFlow) {
        alternateFlow.description = option.condition;
      }
    });

    this.configuredPropertiesChange.emit(formattedProperties);
  }
}
