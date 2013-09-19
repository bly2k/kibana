define([
  'angular'
],
function (angular) {
  'use strict';

  angular
    .module('kibana.directives')
    .directive('kibanaPanel', function($compile) {
      var editorTemplate =
        '<i class="icon-spinner small icon-spin icon-large panel-loading"' +
          'ng-show="panelMeta.loading == true && !panel.title"></i>' +

        '<span class="editlink panelextra pointer" style="right:20px;top:0px" ng-show="panel.editable != false">'+
          '<i ng-show="!$first" class="pointer link icon-chevron-sign-left" ng-click="_.move(row.panels,$index,$index-1)"></i>' +
          '<i style="margin-left:2px" ng-click="movePanelVertical(row, rowScope().$index, panel, $index, +1); " ng-hide="rowScope().$last" class="pointer icon-arrow-down"></i>' +
          '<i style="margin-left:2px" ng-click="movePanelVertical(row, rowScope().$index, panel, $index, -1); " ng-hide="rowScope().$first" class="pointer icon-arrow-up"></i>' +
          '<i style="margin-left:2px" ng-show="!$last" class="pointer link icon-chevron-sign-right" ng-click="_.move(row.panels,$index,$index+1)"></i>' +
          '&nbsp;&nbsp;|&nbsp;&nbsp;' +

          '<span bs-modal="\'app/partials/paneleditor.html\'">' + 
          '<span class="small">{{panel.type}}</span> <i class="icon-cog pointer"></i></span>' +
          '</span>' +
        '</span>' +
        '<h4 ng-show="panel.title">' +
          '{{panel.title}}' +
          '<i class="icon-spinner smaller icon-spin icon-large"' +
            'ng-show="panelMeta.loading == true && panel.title"></i>' +
        '</h4>';
      return {
        restrict: 'E',
        controller: function ($scope) {
          $scope.movePanelVertical = function(row, rowIndex, panel, panelIndex, direction) {
            //compute current span location
            var panelPreSpan = 0;
            for (var p = 0; p < panelIndex; p++) panelPreSpan += row.panels[p].span;

            //compute destination row possible index
            var destRow = $scope.dashboard.current.rows[rowIndex + direction];
            var destPanelIndex = -1, destPanelSpan = 0;
            for (var p = 0; p < destRow.panels.length; p++) {
              destPanelSpan += destRow.panels[p].span;
              if (destPanelSpan > panelPreSpan) {
                destPanelIndex = p;
                break;
              }
            }

            //copy
            if (destPanelIndex >= 0 && destRow.panels.length > destPanelIndex)
              destRow.panels.splice(destPanelIndex, 0, panel);
            else
              destRow.panels.push(panel);

            //relocate
            row.panels = _.without(row.panels,panel); 
          };

          $scope.rowScope = function()
          {
            return $scope.$parent.$parent;
          }
        },
        link: function($scope, elem, attr) {
          // once we have the template, scan it for controllers and
          // load the module.js if we have any

          // compile the module and uncloack. We're done
          function loadModule($module) {
            $module.appendTo(elem);
            /* jshint indent:false */
            $compile(elem.contents())($scope);
            elem.removeClass("ng-cloak");
          }

          $scope.$watch(attr.type, function (name) {
            elem.addClass("ng-cloak");
            // load the panels module file, then render it in the dom.
            $scope.require([
              'jquery',
              'text!panels/'+name+'/module.html'
            ], function ($, moduleTemplate) {
              var $module = $(moduleTemplate);
              // top level controllers
              var $controllers = $module.filter('ngcontroller, [ng-controller], .ng-controller');
              // add child controllers
              $controllers = $controllers.add($module.find('ngcontroller, [ng-controller], .ng-controller'));

              if ($controllers.length) {
                $controllers.first().prepend(editorTemplate);
                $scope.require([
                  'panels/'+name+'/module'
                ], function() {
                  loadModule($module);
                });
              } else {
                loadModule($module);
              }
            });
          });
        }
      };
    });

});