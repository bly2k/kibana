//source: http://vallandingham.me/bubble_charts_in_d3.html

define([
  'angular',
  'app',
  'underscore',
  'jquery',
  'kbn',
  'd3'
],
function (angular, app, _, $, kbn, d3) {
  'use strict';

  var module = angular.module('kibana.panels.bubblechart', []);
  app.useModule(module);

  module.controller('bubblechart', function($scope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      status: "Experimental",
      description: "Displays a D3 bubble chart (http://vallandingham.me/bubble_charts_in_d3.html)"
    };

    var _d = {
      queries     : {
        mode        : 'all',
        ids         : []
      },
      field   : '_type',
      exclude : [],
      include : null,
      size    : 10,
      order   : 'count',
      spyable : true,
      mode: "count",
      valueField: "",
      decimals: 0,
      decimalSeparator: ".",
      commaSeparator: ",",
      formatString: "{0}",
      termScript: null,
      valueScript: null,
      alias: "",
      valueAlias: "",
      groupSize: 10,
      groupField: "",
      groupAlias: "",
      groupOrder: "term"
    };

    _.defaults($scope.panel, _d);

    $scope.set_refresh = function (state)
    {
      $scope.refresh = state;
    };

    $scope.close_edit = function ()
    {
      if ($scope.refresh) $scope.get_data();
      $scope.refresh = false;
    };

    $scope.init = function ()
    {
      $scope.$on('render', function ()
      {
        $scope.$apply();
      });
      $scope.$on('refresh', function ()
      {
        $scope.get_data();
      });
      $scope.get_data();
    };

    $scope.buildTermsFacet = function(field, name, size, order) {
      var termsFacet = $scope.ejs.TermsFacet(name)
        .field(field)
        .size(size)
        .order(order);

      if ($scope.panel.exclude != null && _.isArray($scope.panel.exclude) && $scope.panel.exclude.length > 0)
        termsFacet = termsFacet.exclude($scope.panel.exclude);

      if ($scope.panel.include != null && $scope.panel.include != "")
        termsFacet = termsFacet.regex($scope.evaluateIncludeExpression($scope.panel.include));

      if ($scope.panel.termScript != null && $scope.panel.termScript != "")
        termsFacet = termsFacet.scriptField($scope.panel.termScript);
      
      return termsFacet;
    }

    $scope.buildTermStatsFacet = function(field, name, size, order) {
      var facet = $scope.ejs.TermStatsFacet(name)
        .keyField(field)
        .size(size)
        .order(order)
        ;

      if ($scope.panel.valueScript != null && $scope.panel.valueScript != "")
        facet = facet.valueScript($scope.panel.valueScript);
      else
        facet = facet.valueField($scope.panel.valueField);
      
      return facet;
    }

    $scope.buildGroupRequest = function(facetQuery) {
      var request = $scope.ejs.Request().indices(dashboard.indices);
      request = request.query(facetQuery);
      var mode = $scope.panel.mode;
      var facet = null;
      switch (mode) {
        case "count":
          facet = $scope.buildTermsFacet($scope.panel.groupField, "groups", $scope.panel.groupSize, $scope.panel.groupOrder);
          break;

        default:
          facet = $scope.buildTermStatsFacet($scope.panel.groupField, "groups", $scope.panel.groupSize, $scope.panel.groupOrder);
          break;
      }
      
      request = request.facet(facet).size(0);
      return request;
    }

    $scope.getFieldLabel = function() {
      return $scope.panel.alias != "" ? $scope.panel.alias : $scope.panel.field;
    }

    $scope.getValueLabel = function() {
      return $scope.panel.valueAlias != "" ? $scope.panel.valueAlias : $scope.panel.valueField;
    }

    $scope.getGroupLabel = function() {
      return $scope.panel.groupAlias != "" ? $scope.panel.groupAlias : $scope.panel.groupField;
    }

    $scope.get_data = function (segment, query_id)
    {
      delete $scope.panel.error;
      if(dashboard.indices.length === 0) return;
      
      if ($scope.panel.field == "") {
        $scope.panel.error = "Field must be specified.";
        return;
      }

      if ($scope.panel.groupField == "") {
        $scope.panel.error = "Group field must be specified.";
        return;
      }

      $scope.panelMeta.loading = true;

      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

      var request = $scope.buildGroupRequest(querySrv.getFacetQuery(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString));
      var primaryRequest = request;
      $scope.inspector = angular.toJson(JSON.parse(request.toString()), true);
      var results = request.doSearch();

      results.then(function(results) {
        $scope.data = [];
        $scope.groups = _.map(results.facets.groups.terms, function(t) { return t.term.toString(); });

        //build value aggregations
        var mode = $scope.panel.mode;
          
        var filterParts = querySrv.getQueryFilterParts(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);

        request = $scope.ejs.Request().indices(dashboard.indices);

        _.each(results.facets.groups.terms, function(t) {
          var group = t.term.toString();
          var groupFilter = $scope.ejs.TermFilter($scope.panel.groupField, t.term);

          var f = null;
          switch (mode) {
            case "count":
              f = $scope.buildTermsFacet($scope.panel.field, group, $scope.panel.size, $scope.panel.order);
              break;

            default:
              if ($scope.panel.valueField == "") {
                $scope.panel.error = "Value field must be specified.";
                return;
              }
              f = $scope.buildTermStatsFacet($scope.panel.field, group, $scope.panel.size, $scope.panel.order);
              break;
          }

          if (f != null) {
            f = f.facetFilter(groupFilter);
            filterParts.filter.should(groupFilter);
            request.facet(f).size(0);
          }
        });

        request = request.query($scope.ejs.FilteredQuery(filterParts.query, filterParts.filter));

        $scope.inspector = 
          angular.toJson(JSON.parse(primaryRequest.toString()),true) + "\r\n\r\n---\r\n\r\n" +
          angular.toJson(JSON.parse(request.toString()),true);

        //execute final query and store it for rendering
        results = request.doSearch();
        results.then(function(results) {
          require(['jquery.number'], function(){
            $scope.data = [];

            //flatten results
            _.each(results.facets, function(f, k) {
              _.each(f.terms, function(t) {
                var point = t;
                point.group = k;
                $scope.data.push(point);
              });
            });

            $scope.panelMeta.loading = false;
            $scope.$emit('render');
          });
        });
      });
    };

    $scope.build_search = function(term, negate) {
      if (_.isUndefined(negate)) negate = false;
      filterSrv.set({ type:'terms', field: $scope.panel.field, value: term.name, mandate: (negate ? 'mustNot':'must')});
    };

    $scope.build_group_search = function(term, negate) {
      if (_.isUndefined(negate)) negate = false;
      filterSrv.set({ type:'terms', field: $scope.panel.groupField, value: term.group, mandate: (negate ? 'mustNot':'must')});
    };

    $scope.formatMetricValue = function(metric) {
      var formatted = $.number(metric, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
      if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != null && $scope.panel.formatString != "")
        formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);
      return formatted;
    }
  });

  module.directive('bubbleChart', function(querySrv) {
    return {
      restrict: 'A',
      link: function(scope, elem) {
        scope.$on('render',function(){
          render_panel();
        });

        angular.element(window).bind('resize', function(){
          render_panel();
        });

        function render_panel() {
          elem.css({height:scope.panel.height||scope.row.height});

          var data = scope.data;
          var chart = BubbleChart(elem[0], elem.width(), elem.height(), scope.groups, BubbleChartTooltip);

          var container = elem.parent();

          chart.init(data, scope.panel.mode);
          chart.toggle_view(container.find('.group-selection a.active').attr("id"));

          container.find('.group-selection a').click(function() {
            var view_type = $(this).attr('id');
            chart.toggle_view(view_type);
            return false;
          });

          if(!scope.$$phase) scope.$apply();
        }

        function BubbleChart(selector, width, height, groups, tooltip) {
          var 
            width = width,
            height = height,
            tooltip = tooltip("bubble_tooltip", 240),
            layout_gravity = 0.001,
            damper = 0.1,
            nodes = [],
            vis, 
            circles, 
            radius_scale;

          var force = d3.layout.force()
            .size([width, height]);

          var maxRadius = 40;
          var minRadius = 5;

          var center = {x: width / 2, y: height / 2};

          var group_centers = { };
          var group_width = width / (groups.length + 1);
          _.each(groups, function (g, i) {
            var group = { 
              x: (i + 1) * group_width,
              y: height / 2
            };
            group_centers[g] = group;
          });

          function buildChart(data, valueField) {
            var distinctTerms = _.unique(_.map(data, function(d) { return d.term; }), false);
            var fillScale = d3.scale.ordinal().domain(distinctTerms).range(querySrv.colors);

            var max_value = d3.max(data, function(d) { return parseFloat(d[valueField]); });
            radius_scale = d3.scale.pow().exponent(0.5).domain([0, max_value]).range([minRadius, maxRadius]);

            data.forEach(function(d){
              var node = {
                radius: radius_scale(parseFloat(d[valueField])),
                value: d[valueField],
                name: d.term,
                group: d.group,
                x: Math.random() * 900,
                y: Math.random() * 800
              };
              nodes.push(node);
            });

            nodes.sort(function(a, b) {return b.value - a.value; });

            vis = d3.select(selector).append("svg")
              .attr("width", width)
              .attr("height", height);

            circles = vis.selectAll("circle")
              .data(nodes);

            circles.enter()
              .append("circle")
              .attr("class", "bubble-chart-bubble")
              .attr("r", 0)
              .attr("fill", function(d, i) { return fillScale(d.name); })
              .attr("stroke", function(d, i) { return fillScale(d.name); })
              .attr("fill-opacity", 0.4)
              .on("click", function(d) { click(d); } )
              .on("mouseover", function(d, i) {show_details(d, i, this);} )
              .on("mouseout", function(d, i) {hide_details(d, i, this);} );

            circles.transition().duration(2000).attr("r", function(d) { return d.radius; });
          }

          function click (d) {
            scope.build_search(d);
            d3.event.preventDefault();
          }

          function charge(d) {
            return -Math.pow(d.radius, 2.0) / 8;
          }

          function start() {
            force.nodes(nodes);
          }

          function display_group_all() {
            force.gravity(layout_gravity)
              .charge(charge)
              .friction(0.9)
              .on("tick", function(e) {
                circles.each(move_towards_center(e.alpha))
                  .attr("cx", function(d) {return d.x;})
                  .attr("cy", function(d) {return d.y;});
              });
            force.start();
            hide_groups();
          }

          function move_towards_center(alpha) {
            return function(d) {
              var cx = center.x;
              var cy = center.y;
              var ax = alpha / 4;
              var ay = alpha;

              d.x += (cx - d.x) * ax * (damper + 0.02);
              d.y += (cy - d.y) * ay * (damper + 0.02);
            };
          }

          function display_by_group() {
            force.gravity(layout_gravity)
              .charge(charge)
              .friction(0.9)
              .on("tick", function(e) {
                circles.each(move_towards_group(e.alpha))
                  .attr("cx", function(d) {return d.x;})
                  .attr("cy", function(d) {return d.y;});
              });
            force.start();
            display_groups();
          }

          function move_towards_group(alpha) {
            return function(d) {
              var target = group_centers[d.group];
              if (_.isUndefined(target)) return;
              d.x = d.x + (target.x - d.x) * (damper + 0.02) * (alpha / 2) * 1.1;
              d.y = d.y + (target.y - d.y) * (damper + 0.02) * alpha * 1.1;
            };
          }

          function display_groups() {
            var groups_x = _.map(group_centers, function(c, g) { return { group: g, x: c.x } });

            var groups_data = groups_x;
            var groups = vis.selectAll(".bubble-chart-group")
              .data(groups_data);

            groups.enter().append("text")
              .attr("class", "bubble-chart-group")
              .attr("x", function(d) { return d.x; })
              .attr("y", 30)
              .attr("text-anchor", "middle")
              .text(function(d) { return d.group;})
              .on("click", function(d) { groupClick(d); } );
          }

          function groupClick(d) {
            scope.build_group_search(d);
            d3.event.preventDefault();
          }

          function hide_groups() {
            vis.selectAll(".bubble-chart-group").remove();
          }

          function show_details(data, i, element) {
            var el = d3.select(element);
            el.attr("stroke", d3.rgb(el.attr("fill")).darker()); 
            if (!_.isUndefined(tooltip)) {
              var content = "<span class=\"name\">" + scope.getFieldLabel() + ":</span><span class=\"value\"> " + data.name + "</span><br/>";
              content +="<span class=\"name\">" + scope.getValueLabel() + ":</span><span class=\"value\"> " + scope.formatMetricValue(data.value) + "</span><br/>";
              content +="<span class=\"name\">" + scope.getGroupLabel() + ":</span><span class=\"value\"> " + data.group + "</span>";
              tooltip.showTooltip(content, d3.event);
            }
          }

          function hide_details(data, i, element) {
            var el = d3.select(element);
            el.attr("stroke", d3.rgb(el.attr("fill")));
            if (!_.isUndefined(tooltip)) tooltip.hideTooltip();
          }

          function reset() {
            d3.select(elem[0]).selectAll("svg").remove();
          }

          var my_mod = {};

          my_mod.init = function (data, valueField) {
            reset();
            buildChart(data, valueField);
            start();
          };

          my_mod.toggle_view = function(view_type) {
            var container = elem.parent();
            container.find(".group-selection a").removeClass('active');
            container.find(".group-selection #" + view_type).toggleClass('active');

            if (view_type == 'group') {
              display_by_group();
            } else {
              display_group_all();
              }
            };

          return my_mod;
        }

        function BubbleChartTooltip(tooltipId, width){
          var tooltipId = tooltipId;

          $("#"+tooltipId).remove();
          
          $("body").append("<div class='bubble-tooltip' id='"+tooltipId+"'></div>");
  
          if(width) {
            $("#"+tooltipId).css("width", width);
          }
  
          hideTooltip();
  
          function showTooltip(content, event){
            $("#"+tooltipId).html(content);
            $("#"+tooltipId).show();
            updatePosition(event);
          }
  
          function hideTooltip(){
            $("#"+tooltipId).hide();
          }
  
          function updatePosition(event){
            var ttid = "#"+tooltipId;
            var xOffset = 20;
            var yOffset = 10;
    
            var ttw = $(ttid).width();
            var tth = $(ttid).height();
            var wscrY = $(window).scrollTop();
            var wscrX = $(window).scrollLeft();
            var curX = (document.all) ? event.clientX + wscrX : event.pageX;
            var curY = (document.all) ? event.clientY + wscrY : event.pageY;
            var ttleft = ((curX - wscrX + xOffset*2 + ttw) > $(window).width()) ? curX - ttw - xOffset*2 : curX + xOffset;
            if (ttleft < wscrX + xOffset){
              ttleft = wscrX + xOffset;
            } 
            var tttop = ((curY - wscrY + yOffset*2 + tth) > $(window).height()) ? curY - tth - yOffset*2 : curY + yOffset;
            if (tttop < wscrY + yOffset){
              tttop = curY + yOffset;
            } 
            $(ttid).css('top', tttop + 'px').css('left', ttleft + 'px');
          }
  
          return {
            showTooltip: showTooltip,
            hideTooltip: hideTooltip,
            updatePosition: updatePosition
          }
        }

      }
    };
  });

});